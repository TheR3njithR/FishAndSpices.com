import { describe, expect, it } from 'vitest';
import { scoreCandidate } from '../server/services/matching.js';

const buyer = {
  category: 'spices', product: 'Cardamom', quantity: 1000, productForm: 'Whole', grade: 'AGEB',
  requiredDate: '2026-08-01', packingRequirements: '25 kg bags', certificationRequirements: 'Organic'
};
const seller = {
  category: 'spices', product: 'cardamom', currentQuantity: 2000, minimumOrder: 500,
  productForm: 'Whole', grade: 'AGEB', availabilityDate: '2026-07-01', deliveryCapability: true,
  exportCapability: true, packingCapability: true, certificationRequirement: 'Organic', verificationStatus: 'Verified'
};

describe('deterministic match scoring', () => {
  it('scores a fully aligned and verified candidate at 100', () => {
    expect(scoreCandidate(buyer, seller)).toMatchObject({ score: 100, conflicts: [] });
  });

  it('records explicit conflicts and reduces the score deterministically', () => {
    const result = scoreCandidate(buyer, { ...seller, grade: 'Bulk', availabilityDate: '2026-09-01', verificationStatus: 'Pending' });
    expect(result.score).toBe(65);
    expect(result.conflicts).toEqual(expect.arrayContaining([
      'Grade differs.',
      'Seller availability is later than the buyer required date.',
      'Seller is not fully verified.'
    ]));
  });

  it('does not suggest a different product or category', () => {
    expect(scoreCandidate(buyer, { ...seller, product: 'Pepper' })).toBeNull();
    expect(scoreCandidate(buyer, { ...seller, category: 'fish' })).toBeNull();
  });
});
