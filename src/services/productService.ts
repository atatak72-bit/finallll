import { supabase } from '../lib/supabase'

export interface ProductInput {
  store_id: string
  asin: string
  title: string
  amazon_price: number
  category?: string
  in_stock?: boolean
  is_prime?: boolean
  profit_margin?: number
  ebay_fee?: number
}

export interface ProcessProductResult {
  success: boolean
  message: string
  calculated_ebay_price?: number
  error?: string
}

export async function addAmazonProduct(productData: ProductInput): Promise<ProcessProductResult> {
  try {
    const { data, error } = await supabase.functions.invoke('process-product', {
      body: productData,
    })

    if (error) {
      console.error('Edge Function Hatası:', error)
      return {
        success: false,
        message: 'Sunucu hatası oluştu.',
        error: error.message,
      }
    }

    const result = data?.data?.[0] || data

    if (!result.success) {
      return {
        success: false,
        message: result.message || 'Ürün eklenemedi (VeRO veya kural ihlali).',
        calculated_ebay_price: 0,
      }
    }

    return {
      success: true,
      message: result.message || 'Ürün başarıyla eklendi.',
      calculated_ebay_price: result.calculated_ebay_price,
    }
  } catch (err: any) {
    console.error('Beklenmeyen Hata:', err)
    return {
      success: false,
      message: 'İşlem sırasında beklenmedik bir hata oluştu.',
      error: err.message,
    }
  }
}

export async function addBulkAmazonProducts(products: ProductInput[]): Promise<ProcessProductResult[]> {
  const results: ProcessProductResult[] = [];
  for (const product of products) {
    const res = await addAmazonProduct(product);
    results.push(res);
  }
  return results;
}
