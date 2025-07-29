import { logger } from './logger.ts';

// Utility for sending metrics to Commander4 ingest endpoints
export async function sendIngestPayload({
    apiUrl,
    token,
    platform,
    payload,
}: {
    apiUrl: string;
    token: string;
    platform: 'gitlab' | 'jira' | 'dora';
    payload: unknown;
}) {
    const url = `${apiUrl}/v1/ingest/nova/${platform}`;
    const headers = {
        'Authorization': `Bearer ${token}`,
        'X-API-Key': `${token}`,
        'Content-Type': 'application/json',
    };
    logger.debug('[ingest] POST', url);
    //logger.debug('[ingest] Payload:', JSON.stringify(payload, null, 2));
    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const errorText = await res.text();
        logger.debug('[ingest] Response status:', res.status);
        //console.debug('[ingest] Response body:', errorText);
        throw new Error(`Ingest failed: ${res.status} ${errorText}`);
    }
    return await res.json();
}
