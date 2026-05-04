const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectData() {
  console.log('Fetching all cabinet items to inspect descriptions...');
  const { data, error } = await supabase
    .from('cabinet_items')
    .select('drug_name, description, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching data:', error.message);
    if (error.message.includes('column "description" does not exist')) {
        console.log('CRITICAL: Database column "description" is STILL MISSING.');
    }
  } else {
    console.log('Cabinet Items in Database:');
    data.forEach(item => {
      console.log(`- ${item.drug_name}: [${item.description || 'NULL'}] (Saved at: ${item.created_at})`);
    });
    
    const nullCount = data.filter(i => !i.description).length;
    console.log(`\nSummary: ${data.length} total items, ${nullCount} have NO description.`);
  }
}

inspectData();
