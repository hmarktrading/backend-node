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
  const fieldByName = Object.fromEntries(table.fields.map((f) => [f.name, f]));

  const renames = {
    'Days Since Purchase': 'Days Since Last Purchase',
    'Lifetime Value': 'Lifetime Value (Rs.)',
    'Last Order Products': "Products In The Customer's Latest Order",
    Caller: 'Caller Name',
    'Shopify Link': 'Shopify Latest Customer Order Link',
    'Last Call Date': 'Called Date',
  };

  for (const [oldName, newName] of Object.entries(renames)) {
    const f = fieldByName[oldName];
    if (!f) {
      console.log('SKIP (not found):', oldName);
      continue;
    }
    await axios.patch(
      `https://api.airtable.com/v0/meta/bases/${baseId}/tables/${table.id}/fields/${f.id}`,
      { name: newName },
      { headers }
    );
    console.log('Renamed:', oldName, '->', newName);
  }

  const lifetimeValueField = fieldByName['Lifetime Value'] || { type: 'number', options: { precision: 2 } };

  const newFields = [
    { name: 'Number Of Orders Placed', type: 'number', options: { precision: 0 } },
    { name: 'Revenue (If Reactivated)', type: lifetimeValueField.type, options: lifetimeValueField.options },
    { name: 'Remarks', type: 'multilineText' },
  ];

  for (const nf of newFields) {
    if (fieldByName[nf.name]) {
      console.log('SKIP (already exists):', nf.name);
      continue;
    }
    try {
      await axios.post(
        `https://api.airtable.com/v0/meta/bases/${baseId}/tables/${table.id}/fields`,
        nf,
        { headers }
      );
      console.log('Created:', nf.name);
    } catch (e) {
      console.log('FAILED to create', nf.name, e.response?.data || e.message);
    }
  }

  console.log('Done.');
})().catch((e) => console.error(e.response?.data || e.message));