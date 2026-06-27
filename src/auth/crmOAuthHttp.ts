import https from "https";
import { URL } from "url";

/**
 * POST helper for RapidoCRM token endpoint.
 * Uses Node https directly — more reliable than fetch on some Windows networks.
 */
export async function postOAuthForm(
  tokenUrl: string,
  headers: Record<string, string>,
  body: string
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const parsed = new URL(tokenUrl);

  const { statusCode, responseText } = await new Promise<{
    statusCode: number;
    responseText: string;
  }>((resolve, reject) => {
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 30_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            statusCode: res.statusCode ?? 500,
            responseText: Buffer.concat(chunks).toString("utf8"),
          })
        );
      }
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("RapidoCRM token request timed out"));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });

  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    data = { raw: responseText.slice(0, 500) };
  }

  const ok = statusCode >= 200 && statusCode < 300 && !data.error;

  return { ok, status: statusCode, data };
}
