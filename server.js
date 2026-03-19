// ═══════════════════════════════════════════════════════════
//  JOSS DESIGN — Backend Izipay
//  Node.js + Express
//
//  ENDPOINTS:
//    GET  /                → health check
//    POST /create-payment  → crea formToken (flujo KR embebido)
//    POST /charge-card     → cobra tarjeta directamente vía REST
//    POST /ipn             → webhook de Izipay
//
//  VARIABLES EN RAILWAY:
//    IZIPAY_SHOP_ID   = 19131378
//    IZIPAY_PASSWORD  = prodpassword_4qOwaYvg...
//    IZIPAY_API_URL   = https://api.micuentaweb.pe
// ═══════════════════════════════════════════════════════════

require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const SHOP_ID  = process.env.IZIPAY_SHOP_ID  || '19131378';
const PASSWORD = process.env.IZIPAY_PASSWORD || 'prodpassword_4qOwaYvgLvrBWaqp1ny8qBX3so9mxQJBXBAxlWsGKvzP5';
const API_URL  = process.env.IZIPAY_API_URL  || 'https://api.micuentaweb.pe';
const AUTH     = 'Basic ' + Buffer.from(SHOP_ID + ':' + PASSWORD).toString('base64');

async function izipayPost(endpoint, body) {
  const res = await fetch(API_URL + endpoint, {
    method: 'POST',
    headers: { 'Authorization': AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

// ── Health check ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Joss Design — Izipay Backend' });
});

// ── POST /create-payment ─────────────────────────────────────
app.post('/create-payment', async (req, res) => {
  const { amount, currency = 'PEN', orderId, customer } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Monto inválido' });
  try {
    const data = await izipayPost('/api-payment/V4/Charge/CreatePayment', {
      amount, currency, orderId,
      customer: {
        email:     customer?.email     || '',
        firstName: customer?.firstName || '',
        lastName:  customer?.lastName  || ''
      }
    });
    if (data.status === 'SUCCESS' && data.answer?.formToken) {
      return res.json({ formToken: data.answer.formToken });
    }
    console.error('create-payment:', JSON.stringify(data));
    return res.status(500).json({ error: data.answer?.errorMessage || 'Error Izipay' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /charge-card ─────────────────────────────────────────
//  Recibe: { amount, currency, orderId, customer, card }
//  card  : { pan, expiry (MMYY), cvv, holder }
//  Retorna: { success: true } o { success: false, error: "..." }
// ─────────────────────────────────────────────────────────────
app.post('/charge-card', async (req, res) => {
  const { amount, currency = 'PEN', orderId, customer, card } = req.body;

  if (!amount || amount <= 0) return res.status(400).json({ success: false, error: 'Monto inválido' });
  if (!card?.pan)   return res.status(400).json({ success: false, error: 'Número de tarjeta requerido' });
  if (!card?.expiry) return res.status(400).json({ success: false, error: 'Vencimiento requerido' });
  if (!card?.cvv)   return res.status(400).json({ success: false, error: 'CVV requerido' });

  try {
    // Intentar cobro directo incluyendo datos de tarjeta en paymentForms
    const data = await izipayPost('/api-payment/V4/Charge/CreatePayment', {
      amount,
      currency,
      orderId,
      customer: {
        email:     customer?.email     || '',
        firstName: customer?.firstName || '',
        lastName:  customer?.lastName  || ''
      },
      paymentForms: [{
        paymentMethodType: 'CARD',
        pan:    card.pan,
        expiry: card.expiry,   // MMYY p.ej. "0428"
        cvv:    card.cvv,
        holder: card.holder || `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim()
      }]
    });

    console.log('charge-card response:', JSON.stringify(data));

    if (data.status === 'SUCCESS') {
      const status = data.answer?.orderStatus;
      if (status === 'PAID') {
        return res.json({ success: true, orderId, orderStatus: status });
      }
      const txMsg = data.answer?.transactions?.[0]?.errorMessage
        || data.answer?.errorMessage
        || 'Pago rechazado por el banco. Verifica los datos.';
      return res.status(402).json({ success: false, error: txMsg });
    }

    const errMsg = data.answer?.errorMessage || `Error Izipay: ${data.status}`;
    console.error('charge-card error:', errMsg);
    return res.status(500).json({ success: false, error: errMsg });

  } catch (err) {
    console.error('charge-card exception:', err);
    return res.status(500).json({ success: false, error: 'Error de red: ' + err.message });
  }
});

// ── POST /ipn ────────────────────────────────────────────────
app.post('/ipn', (req, res) => {
  console.log('IPN:', JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend corriendo en puerto ${PORT}`));