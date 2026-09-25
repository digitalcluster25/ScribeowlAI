// Языки перевода: code — ключ хранения, prompt — как назвать язык модели.
export type Language = { code: string; label: string; native: string; prompt: string }

export const LANGUAGES: Language[] = [
  { code: "ru", label: "Русский", native: "Русский", prompt: "Russian (русский)" },
  { code: "en", label: "Английский", native: "English", prompt: "English" },
  { code: "uk", label: "Украинский", native: "Українська", prompt: "Ukrainian (українська)" },
  { code: "es", label: "Испанский", native: "Español", prompt: "Spanish (español)" },
  { code: "de", label: "Немецкий", native: "Deutsch", prompt: "German (Deutsch)" },
  { code: "fr", label: "Французский", native: "Français", prompt: "French (français)" },
  { code: "it", label: "Итальянский", native: "Italiano", prompt: "Italian (italiano)" },
  { code: "pt", label: "Португальский", native: "Português", prompt: "Portuguese (português)" },
  { code: "pl", label: "Польский", native: "Polski", prompt: "Polish (polski)" },
  { code: "tr", label: "Турецкий", native: "Türkçe", prompt: "Turkish (Türkçe)" },
  { code: "kk", label: "Казахский", native: "Қазақ тілі", prompt: "Kazakh (қазақ тілі)" },
  { code: "be", label: "Белорусский", native: "Беларуская", prompt: "Belarusian (беларуская)" },
  { code: "zh", label: "Китайский", native: "中文", prompt: "Chinese, Simplified (简体中文)" },
  { code: "ja", label: "Японский", native: "日本語", prompt: "Japanese (日本語)" },
  { code: "ko", label: "Корейский", native: "한국어", prompt: "Korean (한국어)" },
  { code: "ar", label: "Арабский", native: "العربية", prompt: "Arabic (العربية)" },
  { code: "hi", label: "Хинди", native: "हिन्दी", prompt: "Hindi (हिन्दी)" },
  { code: "nl", label: "Нидерландский", native: "Nederlands", prompt: "Dutch (Nederlands)" },
  { code: "sv", label: "Шведский", native: "Svenska", prompt: "Swedish (svenska)" },
  { code: "cs", label: "Чешский", native: "Čeština", prompt: "Czech (čeština)" },
  { code: "he", label: "Иврит", native: "עברית", prompt: "Hebrew (עברית)" },
  { code: "ka", label: "Грузинский", native: "ქართული", prompt: "Georgian (ქართული)" },
  { code: "hy", label: "Армянский", native: "Հայերեն", prompt: "Armenian (հայերեն)" },
  { code: "sr", label: "Сербский", native: "Српски", prompt: "Serbian (српски)" }
]

export const languageByCode = (code?: string | null) => LANGUAGES.find((l) => l.code === code)
