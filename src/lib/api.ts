import { NextResponse } from 'next/server';
import { HttpError } from './security';

/**
 * Runs a route handler and turns errors into JSON responses. HttpErrors carry a
 * client-safe message; anything else is logged and returned as a generic 500, so
 * internal details (stack traces, provider errors) never reach the browser.
 */
export async function handle(label: string, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error: any) {
    if (error instanceof HttpError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status, headers: error.headers });
    }
    console.error(`${label} error:`, error);
    return NextResponse.json({ success: false, error: `${label} failed. Please try again.` }, { status: 500 });
  }
}
