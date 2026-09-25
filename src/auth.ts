// Supabase Auth в браузере: только вход и токен. Данные — через наш API (FastAPI).
import { createClient, type Session } from "@supabase/supabase-js"
import { useEffect, useState } from "react"

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const supabase = url && key ? createClient(url, key) : null
export const authConfigured = Boolean(supabase)

export async function accessToken(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])
  return { session, loading }
}

export async function signIn(email: string, password: string) {
  if (!supabase) throw new Error("Supabase не настроен (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY)")
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function signUp(email: string, password: string) {
  if (!supabase) throw new Error("Supabase не настроен")
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  // локально подтверждение email выключено → сессия сразу
  if (!data.session) throw new Error("Проверьте почту и подтвердите email, затем войдите.")
}

export async function signOut() {
  await supabase?.auth.signOut()
}
