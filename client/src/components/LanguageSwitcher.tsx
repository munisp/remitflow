import { useTranslation } from "react-i18next";
import { Globe, Search } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { LANGUAGE_OPTIONS } from "@/i18n";
import { haptics } from "@/lib/haptics";
import { useState } from "react";

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const [filter, setFilter] = useState("");
  const current = LANGUAGE_OPTIONS.find((l) => l.code === i18n.language) ?? LANGUAGE_OPTIONS[0];

  const changeLanguage = (code: string) => {
    haptics.selection();
    i18n.changeLanguage(code);
    localStorage.setItem("remitflow_lang", code);
    // Set dir attribute for RTL languages
    const opt = LANGUAGE_OPTIONS.find((l) => l.code === code);
    document.documentElement.dir = (opt && "rtl" in opt && opt.rtl) ? "rtl" : "ltr";
  };

  const filteredLangs = filter
    ? LANGUAGE_OPTIONS.filter(
        (l) =>
          l.label.toLowerCase().includes(filter.toLowerCase()) ||
          l.nativeLabel.toLowerCase().includes(filter.toLowerCase()) ||
          l.code.toLowerCase().includes(filter.toLowerCase())
      )
    : LANGUAGE_OPTIONS;

  // Group: Nigerian languages, then African, then Global
  const nigerianCodes = new Set(["yo", "ig", "ha", "pcm"]);
  const africanCodes = new Set(["sw", "am", "ak", "wo", "ff"]);
  const nigerian = filteredLangs.filter((l) => nigerianCodes.has(l.code));
  const african = filteredLangs.filter((l) => africanCodes.has(l.code));
  const global = filteredLangs.filter((l) => !nigerianCodes.has(l.code) && !africanCodes.has(l.code));

  return (
    <DropdownMenu onOpenChange={() => setFilter("")}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 px-2 text-muted-foreground hover:text-foreground"
          title="Change language"
          aria-label="Change language"
        >
          <Globe className="h-4 w-4" />
          <span className="text-sm font-medium">{current.flag} {current.code.toUpperCase()}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 max-h-80 overflow-y-auto">
        {/* Search */}
        <div className="flex items-center gap-2 px-2 py-1.5 border-b">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            type="text"
            placeholder="Search languages..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground/60 no-min-touch"
          />
        </div>

        {/* Global languages */}
        {global.length > 0 && (
          <>
            <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Global</div>
            {global.map((lang) => (
              <DropdownMenuItem
                key={lang.code}
                onClick={() => changeLanguage(lang.code)}
                className={`gap-2 cursor-pointer ${i18n.language === lang.code ? "font-semibold text-primary" : ""}`}
              >
                <span>{lang.flag}</span>
                <span className="flex-1">{lang.nativeLabel}</span>
                <span className="text-xs text-muted-foreground">{lang.label}</span>
                {i18n.language === lang.code && (
                  <span className="text-primary text-xs">✓</span>
                )}
              </DropdownMenuItem>
            ))}
          </>
        )}

        {/* Nigerian languages */}
        {nigerian.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Nigeria 🇳🇬</div>
            {nigerian.map((lang) => (
              <DropdownMenuItem
                key={lang.code}
                onClick={() => changeLanguage(lang.code)}
                className={`gap-2 cursor-pointer ${i18n.language === lang.code ? "font-semibold text-primary" : ""}`}
              >
                <span>{lang.flag}</span>
                <span className="flex-1">{lang.nativeLabel}</span>
                <span className="text-xs text-muted-foreground">{lang.label}</span>
                {i18n.language === lang.code && (
                  <span className="text-primary text-xs">✓</span>
                )}
              </DropdownMenuItem>
            ))}
          </>
        )}

        {/* Other African languages */}
        {african.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Africa</div>
            {african.map((lang) => (
              <DropdownMenuItem
                key={lang.code}
                onClick={() => changeLanguage(lang.code)}
                className={`gap-2 cursor-pointer ${i18n.language === lang.code ? "font-semibold text-primary" : ""}`}
              >
                <span>{lang.flag}</span>
                <span className="flex-1">{lang.nativeLabel}</span>
                <span className="text-xs text-muted-foreground">{lang.label}</span>
                {i18n.language === lang.code && (
                  <span className="text-primary text-xs">✓</span>
                )}
              </DropdownMenuItem>
            ))}
          </>
        )}

        {filteredLangs.length === 0 && (
          <div className="px-2 py-3 text-sm text-muted-foreground text-center">No languages found</div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
