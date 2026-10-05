import type { CtProduct } from './clients/cardtrader-types';

type ProductOverrides = Partial<CtProduct> & {
  props?: Partial<CtProduct['properties_hash']>;
  hub?: boolean;
};

/** Valid CT Zero listing (NM, EN, non-foil, €10), customizable. */
export function makeProduct(overrides: ProductOverrides = {}): CtProduct {
  const { props, hub, ...rest } = overrides;
  return {
    id: 1,
    blueprint_id: 10,
    quantity: 1,
    price: { cents: 1000, currency: 'EUR' },
    graded: false,
    on_vacation: false,
    user: { can_sell_via_hub: hub ?? true },
    ...rest,
    properties_hash: {
      condition: 'Near Mint',
      mtg_language: 'en',
      mtg_foil: false,
      signed: false,
      altered: false,
      ...props,
    },
  };
}
