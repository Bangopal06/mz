import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    GATEWAY_URL: process.env['GATEWAY_URL'] ?? 'NOT SET',
    GATEWAY_API_KEY_SET: !!process.env['GATEWAY_API_KEY'],
  });
}
