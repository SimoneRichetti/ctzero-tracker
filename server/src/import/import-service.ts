import type { ImportResolve, ImportResolveResult } from '@ctzero/shared';
import type { Catalog } from '../catalog/catalog';
import type { CardTraderClient } from '../clients/cardtrader';
import { cardExistsByOracleId } from '../db/cards-repo';
import type { Db } from '../db/db';
import { ValidationError } from '../errors';
import { priceCard } from '../pricing/card-pricer';

export interface ImportServiceDeps {
  db: Db;
  catalog: Pick<Catalog, 'lookup' | 'resolveBlueprints'>;
  ct: Pick<CardTraderClient, 'products'>;
}

export class ImportService {
  constructor(private readonly deps: ImportServiceDeps) {}

  /** Resolves one decklist line: canonical name, expansions, current price. Saves nothing. */
  async resolve(input: ImportResolve): Promise<ImportResolveResult> {
    const { db, catalog, ct } = this.deps;
    const lookup = await catalog.lookup(input.name);
    let expansionIds: number[] = [];
    if (input.respectSet && input.setCode) {
      const code = input.setCode.toLowerCase();
      const printing = lookup.printings.find((p) => p.code.toLowerCase() === code);
      if (!printing) throw new ValidationError(`Set "${input.setCode.toUpperCase()}" not found for "${lookup.name}"`);
      expansionIds = [printing.expansionId];
    }
    const blueprints = await catalog.resolveBlueprints(lookup, expansionIds);
    const result = await priceCard(ct, blueprints, input);
    return {
      name: lookup.name,
      imageUrl: lookup.imageUrl,
      expansionIds,
      priceCents: result.status === 'ok' ? result.priceCents : null,
      listing: result.status === 'ok' ? result.listing : null,
      alreadyTracked: cardExistsByOracleId(db, lookup.oracleId),
    };
  }
}
