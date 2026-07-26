import {describe, it, after, before} from "node:test";
import assert from "node:assert";
import { userService } from "./user.service.js";
import { db } from "../lib/db.js";

describe("UserService Integration Tests", () => {
  const testEmails = [
    "olivia.bennett@aurasync.com",
    "duplicate.test@aurasync.com",
    "update.test@aurasync.com",
    "delete.test@aurasync.com",
    "searchable.user@aurasync.com",
  ];

  let mainUserId: string;

  before(async () => {
    await db("users").whereIn("email", testEmails).del();
  });

  after(async () => {
    await db("users").whereIn("email", testEmails).del();
  });

  // --- CREATE ---
  describe("1. Create User", () => {
    it("should successfully create a new user", async () => {
      const userData = {
        first_name: "Olivia",
        last_name: "Bennett",
        email: testEmails[0]!,
        password: "SuperSecurePassword123!",
      };

      const user = await userService.createUser(userData);
      mainUserId = user.id as string;

      assert.ok(user.id);
      assert.strictEqual(user.first_name, "Olivia");
      assert.strictEqual(user.last_name, "Bennett");
      assert.strictEqual(user.email, testEmails[0]);
      assert.strictEqual((user as any).password_hash, undefined);
    });

    it("should prevent creation with duplicate email", async () => {
      const duplicateData = {
        first_name: "Clone",
        last_name: "Bennett",
        email: testEmails[0]!,
        password: "AnotherPassword321!",
      };

      await assert.rejects(
        async () => await userService.createUser(duplicateData),
        (err: Error) => {
          assert.strictEqual(err.message, "Email already registered");
          return true;
        }
      );
    });
  });

  // --- GET / READ ---
  describe("2. Get Users", () => {
    it("should retrieve an existing user by ID", async () => {
      const user = await userService.getUserById(mainUserId);

      assert.ok(user);
      assert.strictEqual(user.id, mainUserId);
    });

    it("should return null for a non-existent user ID", async () => {
      const fakeId = "123e4567-e89b-12d3-a456-426614174000";
      const user = await userService.getUserById(fakeId);
      assert.strictEqual(user, null);
    });

    it("should list users with pagination", async () => {
      const result = await userService.getUsers(1, 10);

      assert.ok(result.users);
      assert.ok(Array.isArray(result.users));
      assert.ok(result.total >= 1);
    });
  });

  // --- UPDATE ---
  describe("3. Update User", () => {
    it("should update user basic info successfully", async () => {
      const updateData = {
        username: "olivia.marie", // Adicionado!
        first_name: "Olivia Marie",
        last_name: "Bennett-Smith"
      };

      const updatedUser = await userService.updateUser(mainUserId, updateData);

      assert.ok(updatedUser);
      assert.strictEqual(updatedUser.first_name, "Olivia Marie");
      assert.strictEqual(updatedUser.id, mainUserId);
    });
  });

  // --- PASSWORD & AUTH ---
  describe("4. Authentication and Password", () => {
    it("should authenticate with correct credentials", async () => {
      const user = await userService.authenticateUser({
        email: testEmails[0]!,
        password: "SuperSecurePassword123!"
      });

      assert.ok(user);
      assert.strictEqual(user.email, testEmails[0]);
    });

    it("should change password successfully", async () => {
      const changeResult = await userService.changePassword(mainUserId, {
        current_password: "SuperSecurePassword123!",
        new_password: "NewPassword2026@"
      });

      assert.strictEqual(changeResult, true);
    });
  });

  // --- DELETE ---
  describe("5. Delete User", () => {
    it("should successfully delete a user", async () => {
      const tempUser = await userService.createUser({
        first_name: "To Be",
        last_name: "Deleted",
        email: testEmails[3]!,
        password: "TempPassword123"
      });

      const deleteResult = await userService.deleteUser(tempUser.id as string);
      assert.strictEqual(deleteResult, true);

      const checkUser = await userService.getUserById(tempUser.id as string);
      assert.strictEqual(checkUser, null);
    });
  });

  // --- SEARCH ---
  describe("6. Search Users", () => {
    it("should find users by first name when searching", async () => {
      const user = await userService.createUser({
        first_name: "Searchable",
        last_name: "User",
        email: "searchable.user@aurasync.com",
        password: "SearchPass123!",
      });

      const result = await userService.getUsers(1, 10, { search: "Searchable" });
      assert.ok(result.users.length >= 1);
      assert.ok(result.users.some(u => u.id === user.id));
    });

    it("should find users by last name when searching", async () => {
      const result = await userService.getUsers(1, 10, { search: "User" });
      assert.ok(result.users.length >= 1);
    });
  });
});