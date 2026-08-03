import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { requireUser, errorResponse } from '@server/auth';
import * as sb from '@server/supabase';

const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  json: 'application/json',
  txt: 'text/plain',
};

// Raw-body upload; filename comes via ?filename=. Files go to Supabase Storage
// (public `uploads` bucket) when Supabase is configured — this replaces the
// file hosting Base44 used to provide. Otherwise they are written to
// server/uploads and served by the custom server (server.js) at /uploads/*.
export async function POST(request) {
  const { error } = await requireUser();
  if (error) return error;

  try {
    const body = Buffer.from(await request.arrayBuffer());
    if (body.length === 0) {
      return NextResponse.json({ message: 'Empty upload body' }, { status: 400 });
    }
    if (body.length > 50 * 1024 * 1024) {
      return NextResponse.json({ message: 'File too large (max 50 MB)' }, { status: 413 });
    }
    const url = new URL(request.url);
    const original = path.basename(String(url.searchParams.get('filename') || 'file'));
    const name = `${crypto.randomBytes(8).toString('hex')}-${original.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    if (sb.enabled) {
      const ext = original.split('.').pop().toLowerCase();
      const file_url = await sb.uploadFile(name, body, MIME[ext]);
      return NextResponse.json({ file_url });
    }

    const dir = path.join(process.cwd(), 'server', 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
    return NextResponse.json({ file_url: `/uploads/${name}` });
  } catch (err) {
    return errorResponse(err);
  }
}
