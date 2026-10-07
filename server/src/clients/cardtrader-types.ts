/** Listing returned by GET /marketplace/products (only the fields we use). */
export interface CtProduct {
  id: number;
  blueprint_id: number;
  name_en?: string;
  expansion?: { id: number; code: string; name_en: string };
  quantity: number;
  price: { cents: number; currency: string };
  properties_hash: {
    condition?: string;
    mtg_language?: string;
    mtg_foil?: boolean;
    signed?: boolean;
    altered?: boolean;
    /** Only on products that can be sold opened (e.g. Secret Lair). */
    sealed?: boolean;
  };
  graded?: boolean;
  on_vacation?: boolean;
  user?: { id?: number; username?: string; can_sell_via_hub?: boolean };
}
