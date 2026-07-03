require('dotenv').config();
const axios = require('axios');

const baseId = process.env.AIRTABLE_BASE_ID;
const tableName = process.env.AIRTABLE_TABLE;
const headers = {
  Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
  'Content-Type': 'application/json',
};

(async () => {
  const meta = await axios.get(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, { headers });
  const table = meta.data.tables.find((t) => t.name === tableName);

  const target = table.fields.find((f) => f.name === 'Lifetime Value (Rs.)');
  console.log('Current field config:', JSON.stringify(target, null, 2));

  if (!target) {
    console.log('Field not found.');
    return;
  }

  // Only currency-type fields have a symbol option to fix.
  if (target.type === 'currency') {
    const res = await axios.patch(
      `https://api.airtable.com/v0/meta/bases/${baseId}/tables/${table.id}/fields/${target.id}`,
      { options: { ...target.options, symbol: 'Rs.' } },
      { headers }
    );
    console.log('Updated symbol to Rs. New config:', JSON.stringify(res.data, null, 2));
  } else {
    console.log(`Field type is "${target.type}", not "currency" — no symbol option to change. Paste this output back to Claude.`);
  }
})().catch((e) => console.error(e.response?.data || e.message));