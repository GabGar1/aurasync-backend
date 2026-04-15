import axios from 'axios';
import { productService } from './product.service';

class NuvemshopService {
  private get baseUrl() {
    return `https://api.nuvemshop.com.br/v1/${process.env.NUVEMSHOP_STORE_ID}`;
  }

  private get headers() {
    return {
      'Authentication': `bearer ${process.env.NUVEMSHOP_ACCESS_TOKEN}`,
      'User-Agent': 'AuraSync App (utopiapedras@gmail.com)',
      'Content-Type': 'application/json'
    };
  }

  // O motor principal
  async syncProducts() {
    console.log('Iniciando sincronização com a Nuvemshop...');

    try {
      const response = await axios.get(`${this.baseUrl}/products`, { headers: this.headers });
      const nuvemProducts = response.data;

      let importedCount = 0;

      for (const np of nuvemProducts) {


        const exists = await productService.findByNuvemshopId(np.id.toString());
        if (exists) continue; // Pula se já importamos

        const auraProduct = {
          nuvemshop_id: np.id.toString(),
          name: np.name?.pt || 'Produto sem nome',
          slug: np.handle.handle,
          description: np.description?.pt || '',
          is_active: np.published,
          variants: np.variants.map((nv: any) => ({
            nuvemshop_variant_id: nv.id.toString(),
            sku: nv.sku || `SKU-${nv.id}`,
            name: nv.values.map((v: any) => v.pt).join(' / ') || 'Padrão', // Ex: "Azul / M"
            price: parseFloat(nv.price || '0'),
            cost_price: parseFloat(nv.cost || '0'),
            stock: nv.stock || 0
          }))
        };

        // 4. Salva no nosso PostgreSQL usando o serviço que já temos!
        await productService.createProduct(auraProduct);
        importedCount++;
      }

      console.log(`Sincronização concluída! ${importedCount} produtos importados.`);
      return { success: true, imported: importedCount };

    } catch (error: any) {
      console.error('Erro ao sincronizar com Nuvemshop:', error.response?.data || error.message);
      throw new Error('Falha na integração com Nuvemshop');
    }
  }
}

export const nuvemshopService = new NuvemshopService();