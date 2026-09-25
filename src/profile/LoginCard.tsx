import { useState, type FormEvent } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { authConfigured, signIn, signUp } from "../auth"

export function LoginCard() {
  const [mode, setMode] = useState<"in" | "up">("in")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      await (mode === "in" ? signIn(email, password) : signUp(email, password))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось войти")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>{mode === "in" ? "Вход" : "Регистрация"}</CardTitle>
        <CardDescription>
          Ключи AI-провайдеров хранятся на сервере в зашифрованном виде и привязаны к аккаунту.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!authConfigured ? (
          <p className="text-sm text-destructive">
            Supabase не настроен: задайте VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY в .env.local.
          </p>
        ) : (
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "in" ? "current-password" : "new-password"}
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={busy}>
              {busy ? "..." : mode === "in" ? "Войти" : "Зарегистрироваться"}
            </Button>
            <button
              type="button"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => setMode(mode === "in" ? "up" : "in")}>
              {mode === "in" ? "Нет аккаунта? Регистрация" : "Уже есть аккаунт? Войти"}
            </button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
