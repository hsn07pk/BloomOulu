'use server';
import { redirect } from 'next/navigation';

export async function signInAction(formData: FormData) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  await fetch(`${apiUrl}/v1/auth/magic-link`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: formData.get('email') }),
  });
  redirect(`/${formData.get('locale')}/sign-in/sent`);
}
