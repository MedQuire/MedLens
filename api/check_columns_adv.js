const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkColumns() {
  console.log('Checking columns for cabinet_items...');
  // Query the information_schema directly
  const { data, error } = await supabase
    .rpc('get_table_columns', { table_name: 'cabinet_items' });

  if (error) {
    // If RPC doesn't exist, try a direct query to information_schema if permitted
    console.log('RPC failed, trying information_schema query...');
    const { data: cols, error: err } = await supabase
        .from('information_schema.columns')
        .select('column_name')
        .eq('table_name', 'cabinet_items');
    
    if (err) {
        console.error('Failed to query information_schema:', err.message);
        // Try a simple select * limit 0
        const { error: selectErr } = await supabase.from('cabinet_items').select('description').limit(0);
        console.log('Direct select description result:', selectErr ? selectErr.message : 'SUCCESS');
    } else {
        console.log('Columns found:', cols.map(c => c.column_name));
    }
  } else {
    console.log('Columns found via RPC:', data);
  }
}

checkColumns();
