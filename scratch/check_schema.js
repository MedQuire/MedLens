const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../api/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkSchema() {
  const { data, error } = await supabase
    .from('cabinet_items')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Error fetching items:', error);
  } else {
    console.log('Columns in cabinet_items:', Object.keys(data[0] || {}));
  }
}

checkSchema();
