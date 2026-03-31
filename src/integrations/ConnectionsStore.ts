import { createClient } from "@supabase/supabase-js";

// Note: This operates using service_role, allowing access to Vault and bypassing RLS
const supabaseService = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export class ConnectionsStore {
  /**
   * Retrieves a secret/refresh token from Supabase vault associated with a connection.
   */
  async getConnectionSecret(userId: string, provider: string): Promise<string | null> {
    try {
      // Typically, user connections reference a vault ID or are encrypted in the connections table
      // Let's assume there's a user_connections table referencing a vault_secrets table
      // Or simply a metadata field. Adjust as needed for the exact schema.

      const { data, error } = await supabaseService
        .from('user_connections')
        .select(`provider, secret`)
        .eq('user_id', userId)
        .eq('provider', provider)
        .single();
        
      if (error || !data) {
        console.warn(`Connection not found for user ${userId} / provider ${provider}`);
        return null;
      }

      // data.secret might be raw or a reference to a vault id.
      // If it's a vault reference, we'd lookup from vault.decrypted_secrets
      // Assume 'secret' here is decrypted or stored securely as per your Supabase config
      return data.secret;
    } catch (err) {
      console.error(`Error retrieving connection secret for ${provider}:`, err);
      return null;
    }
  }

  // Example helper to test connectivity / existence
  async hasConnection(userId: string, provider: string): Promise<boolean> {
      const secret = await this.getConnectionSecret(userId, provider);
      return !!secret;
  }
}

export const connectionsStore = new ConnectionsStore();