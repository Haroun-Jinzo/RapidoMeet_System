import {Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { requireAuth} from '../middleware/auth';

export const integrationsRouter = Router();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST /integrations/rapidocrm
// Body: { api_key: "the user's RapidoCRM API key" }
// Called when user fills in the form in the integrations tab
integrationsRouter.post('/rapidocrm', requireAuth, async (req: Request, res: Response) => {
    const user= (req as any).user;
    const { api_key } = req.body;

if(!api_key || typeof api_key !== 'string') {
    return res.status(400).json({ error: 'api_key is required and must be a string' });
}

// Read the user's current external_apis settings if they exist
const { data: existing } = await supabase
  .from('user_settings')
  .select('settings_value')
  .eq('user_id', user.id)
  .eq('settings_key', 'external_apis')
  .maybeSingle();


})
