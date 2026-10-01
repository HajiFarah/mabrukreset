import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
