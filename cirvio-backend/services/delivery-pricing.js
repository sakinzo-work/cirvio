const DELIVERY_DISCOUNT_MID_ORDER = 30;
const FREE_DELIVERY_THRESHOLD = 1000;
const FREE_DELIVERY_MAX_WEIGHT_KG = 2;
const COURIER_HANDLING_FEE = 30;
const LOCAL_SAME_PIN_FEE = 49;

function money(value) { return Math.round((Number(value) || 0) * 100) / 100; }
function positive(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : 0; }
function normalizePinCode(value) { return String(value || '').trim().replace(/\s+/g, ''); }
function validPinCode(value) { return /^\d{6}$/.test(normalizePinCode(value)); }

function courierBaseFee(weightKg) {
    const weight = positive(weightKg);
    if (!weight) throw new Error('Shipment weight is required to calculate courier delivery');
    if (weight <= 0.5) return { baseFee: 69, quoteStatus: 'calculated' };
    if (weight <= 1) return { baseFee: 99, quoteStatus: 'calculated' };
    if (weight <= 2) return { baseFee: 139, quoteStatus: 'calculated' };
    if (weight <= 5) return { baseFee: 199, quoteStatus: 'calculated' };
    return { baseFee: null, quoteStatus: 'needs-courier-quote' };
}

function discountFor({ subtotal, weightKg, charge }) {
    if (!Number.isFinite(charge)) return 0;
    if (subtotal >= FREE_DELIVERY_THRESHOLD) return weightKg <= FREE_DELIVERY_MAX_WEIGHT_KG ? charge : 0;
    if (subtotal >= 500) return Math.min(DELIVERY_DISCOUNT_MID_ORDER, charge);
    return 0;
}

// Buyers provide an address and PIN only; same PIN is a simple local delivery rule.
function calculateDelivery({ subtotal, shipmentWeightKg, deliveryPinCode, originPinCodes = [] }) {
    const amount = money(subtotal);
    const weightKg = money(shipmentWeightKg);
    const buyerPin = normalizePinCode(deliveryPinCode);
    if (!validPinCode(buyerPin)) throw new Error('Enter a valid 6-digit delivery PIN code');
    if (!positive(weightKg)) throw new Error('Shipment weight is required to calculate delivery');
    const origins = [...new Set(originPinCodes.map(normalizePinCode).filter(validPinCode))];
    if (!origins.length) throw new Error('This listing needs a seller pickup PIN code before it can be ordered');
    const local = origins.length === 1 && origins[0] === buyerPin;
    const common = { type: local ? 'local' : 'courier', deliveryPinCode: buyerPin, originPinCodes: origins, shipmentWeightKg: weightKg, calculatedAt: new Date() };
    if (local) {
        const discount = discountFor({ subtotal: amount, weightKg, charge: LOCAL_SAME_PIN_FEE });
        return { ...common, quoteStatus: 'calculated', baseFee: LOCAL_SAME_PIN_FEE, handlingFee: 0, actualCourierRate: null, deliveryDiscount: discount, finalFee: money(LOCAL_SAME_PIN_FEE - discount), customerMessage: discount === LOCAL_SAME_PIN_FEE ? 'Free delivery applied for this order.' : (discount ? `Rs ${discount} delivery discount applied.` : 'Same PIN-code delivery charge applied.') };
    }
    const courier = courierBaseFee(weightKg);
    if (courier.quoteStatus === 'needs-courier-quote') return { ...common, quoteStatus: 'needs-courier-quote', baseFee: null, handlingFee: COURIER_HANDLING_FEE, actualCourierRate: null, deliveryDiscount: 0, finalFee: null, customerMessage: 'This shipment is above 5 kg. CIRVIO will confirm the courier rate; Rs 30 handling applies.' };
    const discount = discountFor({ subtotal: amount, weightKg, charge: courier.baseFee });
    return { ...common, quoteStatus: 'calculated', baseFee: courier.baseFee, handlingFee: 0, actualCourierRate: null, deliveryDiscount: discount, finalFee: money(courier.baseFee - discount), customerMessage: discount === courier.baseFee ? 'Free delivery applied for this order.' : (discount ? `Rs ${discount} delivery discount applied.` : 'Courier charge calculated from the packed weight.') };
}

function applyCourierQuote(delivery, subtotal, actualCourierRate) {
    if (!delivery || delivery.quoteStatus !== 'needs-courier-quote') throw new Error('This order does not need a courier quote');
    const rate = positive(actualCourierRate);
    if (!rate) throw new Error('Enter the actual courier rate');
    const weightKg = positive(delivery.shipmentWeightKg);
    const charge = money(rate + COURIER_HANDLING_FEE);
    const discount = discountFor({ subtotal: money(subtotal), weightKg, charge });
    return { ...delivery, quoteStatus: 'calculated', actualCourierRate: rate, baseFee: rate, handlingFee: COURIER_HANDLING_FEE, deliveryDiscount: discount, finalFee: money(charge - discount), calculatedAt: new Date(), customerMessage: discount ? `Rs ${discount} delivery discount applied.` : 'Courier rate confirmed by CIRVIO.' };
}

module.exports = { calculateDelivery, applyCourierQuote, courierBaseFee, normalizePinCode, validPinCode, COURIER_HANDLING_FEE, LOCAL_SAME_PIN_FEE };
