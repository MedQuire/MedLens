try {
  const { createClient } = require('@supabase/supabase-js');
  console.log('Successfully loaded @supabase/supabase-js');
} catch (e) {
  console.error('Failed to load @supabase/supabase-js:', e.message);
}
