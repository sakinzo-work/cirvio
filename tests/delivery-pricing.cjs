const assert = require('node:assert/strict');
const { calculateDelivery, applyCourierQuote } = require('../cirvio-backend/services/delivery-pricing');
function quote(input) { return calculateDelivery({ subtotal: 350, shipmentWeightKg: 0.5, deliveryPinCode: '400001', originPinCodes: ['400001'], ...input }); }
const local = quote({});
assert.equal(local.type, 'local'); assert.equal(local.baseFee, 49); assert.equal(local.finalFee, 49);
assert.equal(local.deliveryPinCode, '400001');
const midCourier = calculateDelivery({ subtotal: 750, shipmentWeightKg: 1.3, deliveryPinCode: '411001', originPinCodes: ['400001'] });
assert.equal(midCourier.type, 'courier'); assert.equal(midCourier.baseFee, 139); assert.equal(midCourier.deliveryDiscount, 30); assert.equal(midCourier.finalFee, 109);
const freeCourier = calculateDelivery({ subtotal: 1200, shipmentWeightKg: 1.5, deliveryPinCode: '411001', originPinCodes: ['400001'] });
assert.equal(freeCourier.baseFee, 139); assert.equal(freeCourier.deliveryDiscount, 139); assert.equal(freeCourier.finalFee, 0);
const heavy = calculateDelivery({ subtotal: 1200, shipmentWeightKg: 5.1, deliveryPinCode: '411001', originPinCodes: ['400001'] });
assert.equal(heavy.quoteStatus, 'needs-courier-quote');
const confirmed = applyCourierQuote(heavy, 1200, 240);
assert.equal(confirmed.handlingFee, 30); assert.equal(confirmed.finalFee, 270, 'Heavy shipments do not get automatic free delivery');
assert.throws(() => quote({ deliveryPinCode: 'bad' }), /6-digit/);
console.log('PASS PIN-code delivery pricing, discounts and heavy courier quote handling');
