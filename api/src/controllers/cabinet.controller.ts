import { Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { AuthenticatedRequest } from '../middleware/auth.middleware';

// Creates a Supabase client scoped to the authenticated user's JWT
// This ensures RLS policies apply correctly — the user can only see their own data
const getUserScopedClient = (userToken: string) => {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_ANON_KEY!;
  
  if (!url || !key) {
    throw new Error('Supabase configuration missing (URL or Key)');
  }

  return createClient(url, key, {
    db: { schema: 'public' },
    global: { headers: { Authorization: `Bearer ${userToken}` } },
  });
};

export const getCabinetItems = async (req: AuthenticatedRequest, res: Response) => {
  console.log(`[Cabinet] Fetching items for user: ${req.userId}`);
  
  try {
    const supabase = getUserScopedClient(req.userToken!);

    const { data, error, status } = await supabase
      .from('cabinet_items')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error(`[Cabinet] Fetch error (Status ${status}):`, error.message);
      
      // Handle the specific "schema cache" error with a more helpful response
      if (error.message.includes('schema cache')) {
        return res.status(503).json({ 
          error: 'Cabinet service is initializing', 
          message: 'The database schema is being refreshed. Please try again in a few moments.' 
        });
      }

      return res.status(500).json({ error: 'Failed to fetch cabinet items', message: error.message });
    }

    console.log(`[Cabinet] Successfully fetched ${data?.length || 0} items for ${req.userId}`);
    return res.json({ items: data || [], count: (data || []).length });
  } catch (error: any) {
    console.error('[Cabinet] getCabinetItems error:', error.message);
    return res.status(500).json({ error: 'Unexpected error fetching cabinet' });
  }
};

export const saveCabinetItem = async (req: AuthenticatedRequest, res: Response) => {
  const { drug_name, drug_key, description } = req.body;
  console.log(`[Cabinet] Saving ${drug_name} for user: ${req.userId}`);

  if (!drug_name || !drug_key) {
    return res.status(400).json({ error: 'drug_name and drug_key are required' });
  }

  try {
    const supabase = getUserScopedClient(req.userToken!);

    console.log(`[Cabinet] Attempting save for user ${req.userId} on drug ${drug_key} with desc: ${description}`);

    // Try to insert first
    let { data, error, status } = await supabase
      .from('cabinet_items')
      .insert([{ 
        user_id: req.userId, 
        drug_name, 
        drug_key, 
        description,
        source: 'OpenFDA' 
      }])
      .select()
      .single();

    if (error) {
      // ── Fallback ──
      // If the error is a unique violation (code 23505), it means the item was already saved.
      if (error.code === '23505') {
        console.log(`[Cabinet] Item already exists for user ${req.userId}, returning existing data.`);
        const { data: existingData, error: fetchError } = await supabase
          .from('cabinet_items')
          .select()
          .match({ user_id: req.userId, drug_key })
          .single();
        
        if (fetchError) {
          return res.status(500).json({ error: 'Failed to retrieve existing medication', message: fetchError.message });
        }
        
        return res.json({ success: true, item: existingData });
      }

      // If the error is a missing column or schema cache issue, try falling back to save without description
      const isMissingColumn = error.message?.includes('column "description" does not exist') || 
                               error.message?.includes('column cabinet_items.description does not exist');
      const isSchemaCache = error.message?.includes('schema cache');

      if (isMissingColumn || isSchemaCache) {
        console.warn(`[Cabinet] Migration not applied or cache stale. Falling back to save without description. Error: ${error.message}`);
        
        const fallbackResult = await supabase
          .from('cabinet_items')
          .insert([{ 
            user_id: req.userId, 
            drug_name, 
            drug_key, 
            source: 'OpenFDA' 
          }])
          .select()
          .single();
        
        if (!fallbackResult.error) {
          console.log(`[Cabinet] Fallback save successful for ${drug_name}`);
          return res.json({ success: true, item: fallbackResult.data });
        } else if (fallbackResult.error.code === '23505') {
            // Handle unique violation in fallback too
            const { data: existingData } = await supabase
                .from('cabinet_items')
                .select()
                .match({ user_id: req.userId, drug_key })
                .single();
            return res.json({ success: true, item: existingData });
        }
        
        // If fallback also fails, return the 503 if it's still a schema cache issue
        if (fallbackResult.error.message?.includes('schema cache')) {
            return res.status(503).json({ 
                error: 'Cabinet service is initializing', 
                message: 'The database schema is being refreshed. Please try again in a few moments.' 
            });
        }
        
        return res.status(500).json({ error: 'Failed to save medication', message: fallbackResult.error.message });
      }

      console.error(`[Cabinet] Save error (Status ${status}):`, error.message);
      return res.status(500).json({ error: 'Failed to save medication', message: error.message });
    }

    console.log(`[Cabinet] Successfully saved ${drug_name} for ${req.userId}`);
    return res.json({ success: true, item: data });
  } catch (error: any) {
    console.error('[Cabinet] saveCabinetItem error:', error.message);
    return res.status(500).json({ error: 'Unexpected error saving medication' });
  }
};

export const deleteCabinetItem = async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'Item ID is required' });
  }

  try {
    const supabase = getUserScopedClient(req.userToken!);

    console.log(`[Cabinet] Hard deleting item ${id} for user ${req.userId}`);

    const { error, status } = await supabase
      .from('cabinet_items')
      .delete()
      .match({ id: id, user_id: req.userId });

    if (error) {
      console.error(`[Cabinet] Delete error (Status ${status}):`, error.message);
      return res.status(500).json({ error: 'Failed to delete medication from your database', message: error.message });
    }

    return res.json({ success: true, message: 'Medication removed from cabinet' });
  } catch (error: any) {
    console.error('[Cabinet] deleteCabinetItem error:', error.message);
    return res.status(500).json({ error: 'Unexpected error removing medication' });
  }
};
