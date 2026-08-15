function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

export function scoreCandidate(buyer, seller) {
  if (buyer.category !== seller.category || normalized(buyer.product) !== normalized(seller.product)) return null;
  const factors = [{ factor: 'Same category and product', points: 20, result: 'aligned' }];
  const conflicts = [];
  let score = 20;

  const quantityCompatible = Number(seller.currentQuantity) >= Math.min(Number(buyer.quantity), Number(seller.minimumOrder));
  factors.push({ factor: 'Quantity compatibility', points: quantityCompatible ? 15 : 0, result: quantityCompatible ? 'compatible' : 'seller quantity or minimum order requires review' });
  if (quantityCompatible) score += 15; else conflicts.push('Quantity or minimum order requires review.');

  const formAligned = normalized(buyer.productForm) === normalized(seller.productForm);
  factors.push({ factor: 'Product form', points: formAligned ? 10 : 0, result: formAligned ? 'aligned' : 'different or unspecified' });
  if (formAligned) score += 10; else conflicts.push('Product form differs or is unspecified.');

  const specificationAligned = buyer.category === 'spices'
    ? !buyer.grade || !seller.grade || normalized(buyer.grade) === normalized(seller.grade)
    : !buyer.sizeDescription || !seller.sizeDescription || normalized(buyer.sizeDescription) === normalized(seller.sizeDescription);
  factors.push({ factor: buyer.category === 'spices' ? 'Grade' : 'Size', points: specificationAligned ? 10 : 0, result: specificationAligned ? 'compatible or reviewable' : 'conflict recorded' });
  if (specificationAligned) score += 10; else conflicts.push(`${buyer.category === 'spices' ? 'Grade' : 'Size'} differs.`);

  const available = !buyer.requiredDate || !seller.availabilityDate || new Date(seller.availabilityDate) <= new Date(buyer.requiredDate);
  factors.push({ factor: 'Availability', points: available ? 10 : 0, result: available ? 'available by required date' : 'available after required date' });
  if (available) score += 10; else conflicts.push('Seller availability is later than the buyer required date.');

  const delivery = Boolean(seller.deliveryCapability || seller.exportCapability);
  factors.push({ factor: 'Delivery and export capability', points: delivery ? 10 : 0, result: delivery ? 'capability recorded' : 'not recorded' });
  if (delivery) score += 10; else conflicts.push('Delivery/export capability is not recorded.');

  const packing = !buyer.packingRequirements || Boolean(seller.packingCapability);
  factors.push({ factor: 'Packing', points: packing ? 5 : 0, result: packing ? 'capability available or not required' : 'buyer requirement lacks seller capability' });
  if (packing) score += 5; else conflicts.push('Packing capability requires review.');

  const certification = !buyer.certificationRequirements || Boolean(seller.certificationRequirement);
  factors.push({ factor: 'Certification', points: certification ? 5 : 0, result: certification ? 'available or not required' : 'requirement requires review' });
  if (certification) score += 5; else conflicts.push('Certification requirement requires review.');

  const verificationPoints = seller.verificationStatus === 'Verified' ? 15 : seller.verificationStatus === 'In review' ? 5 : 0;
  score += verificationPoints;
  factors.push({ factor: 'Verification status', points: verificationPoints, result: seller.verificationStatus });
  if (seller.verificationStatus !== 'Verified') conflicts.push('Seller is not fully verified.');
  return { score, factors, conflicts };
}

export async function suggestMatches(pool, buyerLeadId) {
  const buyerResult = await pool.query(`
    select l.id, l.public_reference as "publicReference", l.category, l.product, l.quantity,
      br.required_date as "requiredDate", br.packing_requirements as "packingRequirements",
      br.certification_requirements as "certificationRequirements",
      coalesce(fs.product_form, ss.product_form) as "productForm", fs.size_description as "sizeDescription", ss.grade
    from leads l join buyer_requirements br on br.lead_id = l.id
    left join fish_specifications fs on fs.lead_id = l.id
    left join spice_specifications ss on ss.lead_id = l.id
    where l.id = $1 and l.lead_role = 'buyer' and l.archived_at is null
  `, [buyerLeadId]);
  if (!buyerResult.rowCount) {
    const error = new Error('Buyer lead not found.');
    error.status = 404;
    throw error;
  }
  const buyer = buyerResult.rows[0];
  const sellers = await pool.query(`
    select l.id, l.public_reference as "publicReference", l.category, l.product,
      l.verification_status as "verificationStatus", so.current_quantity as "currentQuantity",
      so.minimum_order as "minimumOrder", so.availability_date as "availabilityDate",
      so.delivery_capability as "deliveryCapability", so.export_capability as "exportCapability",
      so.packing_capability as "packingCapability", coalesce(fs.product_form, ss.product_form) as "productForm",
      fs.size_description as "sizeDescription", ss.grade, ss.certification_requirement as "certificationRequirement"
    from leads l join seller_offers so on so.lead_id = l.id
    left join fish_specifications fs on fs.lead_id = l.id
    left join spice_specifications ss on ss.lead_id = l.id
    where l.lead_role = 'seller' and l.category = $1 and lower(l.product) = lower($2) and l.archived_at is null
  `, [buyer.category, buyer.product]);
  return sellers.rows.map(seller => ({ seller, ...scoreCandidate(buyer, seller) })).filter(item => item.score !== null).sort((a, b) => b.score - a.score);
}
