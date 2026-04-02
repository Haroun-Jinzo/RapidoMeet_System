import { createClient } from "@supabase/supabase-js";

/**
 * DB Schema assumption:
 * table connections: (id, user_id, provider, status, metadata, vault_secret_id, created_at, updated_at)
 * We use Supabase Vault to decrypt the secret securely.
 */

const supabaseService = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface ConnectionRecord {
  id: string;
  user_id: string;
  provider: string;
  status: string;
  metadata: any;
  vault_secret_id: string;
}

export class ConnectionsStore {
  /**
   * Retrieves full connection info to verify ownership.
   */
  async getConnection(connectionId: string): Promise<ConnectionRecord | null> {
    try {
      const { data, error } = await supabaseService
        .from('connections')
        .select('*')
        .eq('id', connectionId)
        .single();
        
      if (error || !data) {
        console.warn(`Connection not found: ${connectionId}`);
        return null;
      }
      return data as ConnectionRecord;
    } catch (err) {
      console.error(`Error retrieving connection:`, err);
      return null;
    }
  }

  /**
   * Retrieves a decrypted secret from Supabase Vault using the vault_secret_id.
   */
  async getVaultSecret(vaultSecretId: string): Promise<string | null> {
    try {
      const { data, error } = await supabaseService
        .from('decrypted_secrets')
        .select('decrypted_secret')
        .eq('id', vaultSecretId)
        .single();
        
      if (error || !data) {
        console.warn(`Secret not found in vault or could not be decrypted: ${vaultSecretId}`);
        return null;
      }

      return data.decrypted_secret;
    } catch (err) {
      console.error(`Error retrieving secret from vault:`, err);
      return null;
    }
  }

  // Example helper to test connectivity / existence
  async hasConnection(connectionId: string): Promise<boolean> {
      const conn = await this.getConnection(connectionId);
      return !!conn && conn.status === 'active';
  }
}

export const connectionsStore = new ConnectionsStore();