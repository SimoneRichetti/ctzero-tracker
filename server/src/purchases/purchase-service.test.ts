import type { TrackedCard } from '@ctzero/shared';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { deleteCard, insertCard } from '../db/cards-repo';
import { openDb, type Db } from '../db/db';
import { recordPurchase } from '../db/purchases-repo';
import { NotFoundError, ValidationError } from '../errors';
import { PurchaseService } from './purchase-service';

const t0 = new Date('2026-11-10T10:00:00.000Z');
let db: Db;
type Fn = Mock<(...args: any[]) => any>;

let cards: { restore: Fn };
let sealed: { restore: Fn };
let service: PurchaseService;

function buy(): { cardId: number; purchaseId: number } {
  const card = insertCard(
    db,
    { name: 'Thraben Inspector', scryfallOracleId: 'o1', imageUrl: null, expansionIds: [], languages: [], minCondition: 'Near Mint', foil: null, thresholdCents: 20 },
    t0,
  );
  const rules = { kind: 'card' as const, expansionIds: [], expansionNames: [], languages: [], minCondition: 'Near Mint' as const, foil: null };
  const p = recordPurchase(db, 'card', { ...card, groupName: null, rules }, { pricePaidCents: 18, quantity: 1 }, t0);
  return { cardId: card.id, purchaseId: p.id };
}

beforeEach(() => {
  db = openDb(':memory:');
  cards = { restore: vi.fn(async () => ({ id: 99 }) as TrackedCard) };
  sealed = { restore: vi.fn(async () => ({ id: 98 })) };
  service = new PurchaseService({ db, cards, sealed });
});

describe('PurchaseService', () => {
  it('lists, reads with the history and deletes', () => {
    const { purchaseId } = buy();
    expect(service.list().items.map((p) => p.id)).toEqual([purchaseId]);
    expect(service.get(purchaseId)).toMatchObject({ name: 'Thraben Inspector', points: [] });
    service.delete(purchaseId);
    expect(service.list().items).toEqual([]);
    expect(() => service.get(purchaseId)).toThrow(NotFoundError);
    expect(() => service.delete(purchaseId)).toThrow(NotFoundError);
  });

  it('tracks again only an archived purchase, through the service of its kind', async () => {
    const { cardId, purchaseId } = buy();
    await expect(service.trackAgain(purchaseId)).rejects.toThrow(ValidationError);
    deleteCard(db, cardId);
    const result = await service.trackAgain(purchaseId);
    expect(cards.restore).toHaveBeenCalledWith(expect.objectContaining({ id: purchaseId, points: [] }));
    expect(sealed.restore).not.toHaveBeenCalled();
    expect(result.item).toEqual({ id: 99 });
    await expect(service.trackAgain(404)).rejects.toThrow(NotFoundError);
  });
});
