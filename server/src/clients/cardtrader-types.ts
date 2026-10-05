/** Listing returned by GET /marketplace/products (only the fields we use). */
export interface CtProduct {
  id: number;
  blueprint_id: number;
  quantity: number;
  price: { cents: number; currency: string };
  properties_hash: {
    condition?: string;
    mtg_language?: string;
    mtg_foil?: boolean;
    signed?: boolean;
    altered?: boolean;
  };
  graded?: boolean;
  on_vacation?: boolean;
  user?: { id?: number; username?: string; can_sell_via_hub?: boolean };
}
