const DELIVERY_DISCOUNT_MID_ORDER = 30;
const FREE_DELIVERY_THRESHOLD = 1000;
const FREE_DELIVERY_MAX_WEIGHT_KG = 2;
const COURIER_HANDLING_FEE = 30;

function money(value) { return Math.round((Number(value) || 0) * 100) / 100; }
function positive(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : 0; }
function normalCity(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function displayCity(value) { return String(value || '').trim().replace(/\s+/g, ' '); }

function localBaseFee(distanceKm) {
    const distance = positive(distanceKm);
    if (!distance) throw new Error('Enter the delivery distance in km for local delivery');
    if (distance <= 2) return 49;
    if (distance <= 5) return 69;
    if (distance <= 8) return 89;
    if (distance <= 12) return 119;
    if (distance <= 15) return 149;
    return 149 + Math.ceil(distance - 15) * 10;
}

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
    if (subtotal >= FREE_DELIVERY_THRESHOLD) {
        // Rs 1,000 free delivery is limited to 2 kg. Heavy shipments keep their additional charge.
        return weightKg <= FREE_DELIVERY_MAX_WEIGHT_KG ? charge : 0;
    }
    if (subtotal >= 500) return Math.min(DELIVERY_DISCOUNT_MID_ORDER, charge);
    return 0;
}

function calculateDelivery({ subtotal, shipmentWeightKg, deliveryCity, originCities = [], distanceKm }) {
    const amount = money(subtotal);
    const weightKg = money(shipmentWeightKg);
    const city = displayCity(deliveryCity);
    if (!city) throw new Error('Enter your delivery city to calculate the delivery charge');
    if (!positive(weightKg)) throw new Error('Shipment weight is required to calculate delivery');
    const origins = [...new Set(originCities.map(displayCity).filter(Boolean))];
    const local = origins.length === 1 && normalCity(origins[0]) === normalCity(city);
    const common = {
        type: local ? 'local' : 'courier',
        deliveryCity: city,
        originCities: origins,
        shipmentWeightKg: weightKg,
        distanceKm: local ? money(distanceKm) : null,
        calculatedAt: new Date()
    };

    if (local) {
        const baseFee = localBaseFee(distanceKm);
        const discount = discountFor({ subtotal: amount, weightKg, charge: baseFee });
        return {
            ...common,
            quoteStatus: 'calculated',
            baseFee,
            handlingFee: 0,
            actualCourierRate: null,
            deliveryDiscount: discount,
            finalFee: money(baseFee - discount),
            customerMessage: discount === baseFee && baseFee > 0 ? 'Free delivery applied for this order.' : (discount ? `Rs ${discount} delivery discount applied.` : 'Delivery charge calculated from the local distance slab.')
        };
    }

    const courier = courierBaseFee(weightKg);
    if (courier.quoteStatus === 'needs-courier-quote') {
        return {
            ...common,
            quoteStatus: 'needs-courier-quote',
            baseFee: null,
            handlingFee: COURIER_HANDLING_FEE,
            actualCourierRate: null,
            deliveryDiscount: 0,
            finalFee: null,
            customerMessage: 'This shipment is above 5 kg. CIRVIO will confirm the courier rate; Rs 30 handling applies.'
        };
    }
    const charge = courier.baseFee;
    const discount = discountFor({ subtotal: amount, weightKg, charge });
    return {
        ...common,
        quoteStatus: 'calculated',
        baseFee: charge,
        handlingFee: 0,
        actualCourierRate: null,
        deliveryDiscount: discount,
        finalFee: money(charge - discount),
        customerMessage: discount === charge && charge > 0 ? 'Free delivery applied for this order.' : (discount ? `Rs ${discount} delivery discount applied.` : 'Courier charge calculated from shipment weight.')
    };
}

function applyCourierQuote(delivery, subtotal, actualCourierRate) {
    if (!delivery || delivery.quoteStatus !== 'needs-courier-quote') throw new Error('This order does not need a courier quote');
    const rate = positive(actualCourierRate);
    if (!rate) throw new Error('Enter the actual courier rate');
    const weightKg = positive(delivery.shipmentWeightKg);
    const charge = money(rate + COURIER_HANDLING_FEE);
    const discount = discountFor({ subtotal: money(subtotal), weightKg, charge });
    return {
        ...delivery,
        quoteStatus: 'calculated',
        actualCourierRate: rate,
        baseFee: rate,
        handlingFee: COURIER_HANDLING_FEE,
        deliveryDiscount: discount,
        finalFee: money(charge - discount),
        calculatedAt: new Date(),
        customerMessage: discount ? `Rs ${discount} delivery discount applied.` : 'Courier rate confirmed by CIRVIO.'
    };
}

module.exports = { calculateDelivery, applyCourierQuote, localBaseFee, courierBaseFee, normalCity, COURIER_HANDLING_FEE };
