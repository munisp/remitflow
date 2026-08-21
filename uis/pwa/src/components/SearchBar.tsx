/**
 * Reusable SearchBar Component with OpenSearch Integration
 * Provides autocomplete, suggestions, and real-time search
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { SearchIndex, searchService } from "../services/searchService";

interface SearchBarProps {
  placeholder?: string;
  index?: SearchIndex | SearchIndex[];
  onSearch: (query: string) => void;
  onSuggestionSelect?: (suggestion: string) => void;
  className?: string;
  showRecentSearches?: boolean;
  debounceMs?: number;
  minQueryLength?: number;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  placeholder = "Search...",
  index,
  onSearch,
  onSuggestionSelect,
  className = "",
  showRecentSearches = true,
  debounceMs = 300,
  minQueryLength = 2,
}) => {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch suggestions when query changes
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (query.length >= minQueryLength) {
      setIsLoading(true);
      debounceRef.current = setTimeout(async () => {
        try {
          const results = await searchService.getSuggestions(query, index);
          setSuggestions(results);
        } catch (error) {
          console.error("Failed to fetch suggestions:", error);
          setSuggestions([]);
        } finally {
          setIsLoading(false);
        }
      }, debounceMs);
    } else {
      setSuggestions([]);
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, index, debounceMs, minQueryLength]);

  // Fetch recent searches on mount
  // useEffect(() => {
  //   if (showRecentSearches) {
  //     searchService.getRecentSearches()
  //       .then(setRecentSearches)
  //       .catch(() => setRecentSearches([]));
  //   }
  // }, [showRecentSearches]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    setSelectedIndex(-1);
    setIsOpen(true);
  };

  const handleSubmit = useCallback(
    (searchQuery: string) => {
      if (searchQuery.trim()) {
        onSearch(searchQuery.trim());
        setIsOpen(false);
        // Save to recent searches
        searchService
          .saveRecentSearch(
            searchQuery.trim(),
            Array.isArray(index) ? index[0] : index,
          )
          .catch(() => {});
      }
    },
    [onSearch, index],
  );

  const handleSuggestionClick = (suggestion: string) => {
    setQuery(suggestion);
    setIsOpen(false);
    if (onSuggestionSelect) {
      onSuggestionSelect(suggestion);
    } else {
      handleSubmit(suggestion);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const items = [
      ...suggestions,
      ...(showRecentSearches && query.length < minQueryLength
        ? recentSearches
        : []),
    ];

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, items.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, -1));
        break;
      case "Enter":
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < items.length) {
          handleSuggestionClick(items[selectedIndex]);
        } else {
          handleSubmit(query);
        }
        break;
      case "Escape":
        setIsOpen(false);
        setSelectedIndex(-1);
        break;
    }
  };

  const handleClearRecentSearches = async () => {
    try {
      await searchService.clearRecentSearches();
      setRecentSearches([]);
    } catch (error) {
      console.error("Failed to clear recent searches:", error);
    }
  };

  const showDropdown =
    isOpen &&
    (suggestions.length > 0 ||
      (showRecentSearches &&
        query.length < minQueryLength &&
        recentSearches.length > 0));

  return (
    <div className={`relative ${className}`}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="w-full px-4 py-2 pl-10 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <svg
          className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        {isLoading && (
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
          </div>
        )}
        {query && !isLoading && (
          <button
            onClick={() => {
              setQuery("");
              setSuggestions([]);
              inputRef.current?.focus();
            }}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      {showDropdown && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-80 overflow-y-auto"
        >
          {suggestions.length > 0 && (
            <div className="py-2">
              <div className="px-4 py-1 text-xs font-semibold text-gray-500 uppercase">
                Suggestions
              </div>
              {suggestions.map((suggestion, idx) => (
                <button
                  key={`suggestion-${idx}`}
                  onClick={() => handleSuggestionClick(suggestion)}
                  className={`w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2 ${
                    selectedIndex === idx ? "bg-gray-100" : ""
                  }`}
                >
                  <svg
                    className="w-4 h-4 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                  <HighlightedMatch text={suggestion} query={query} />
                </button>
              ))}
            </div>
          )}

          {showRecentSearches &&
            query.length < minQueryLength &&
            recentSearches.length > 0 && (
              <div className="py-2 border-t border-gray-100">
                <div className="px-4 py-1 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-500 uppercase">
                    Recent Searches
                  </span>
                  <button
                    onClick={handleClearRecentSearches}
                    className="text-xs text-blue-500 hover:text-blue-700"
                  >
                    Clear
                  </button>
                </div>
                {recentSearches.map((search, idx) => (
                  <button
                    key={`recent-${idx}`}
                    onClick={() => handleSuggestionClick(search)}
                    className={`w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2 ${
                      selectedIndex === suggestions.length + idx
                        ? "bg-gray-100"
                        : ""
                    }`}
                  >
                    <svg
                      className="w-4 h-4 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <span>{search}</span>
                  </button>
                ))}
              </div>
            )}
        </div>
      )}
    </div>
  );
};

// Helper to highlight matching text.
// SECURITY (CLI-003): rendered as React nodes, NOT via
// dangerouslySetInnerHTML. Suggestions can be server/API-supplied and the
// query is user input; React escapes all string children, so neither can
// inject markup into the DOM.
const HighlightedMatch: React.FC<{ text: string; query: string }> = ({
  text,
  query,
}) => {
  if (!query) {
    return <span>{text}</span>;
  }
  const regex = new RegExp(`(${escapeRegExp(query)})`, "gi");
  // Split with a capture group: odd-indexed segments are the matches.
  const segments = text.split(regex);
  return (
    <span>
      {segments.map((segment, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="text-blue-600">
            {segment}
          </strong>
        ) : (
          <React.Fragment key={i}>{segment}</React.Fragment>
        ),
      )}
    </span>
  );
};

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default SearchBar;
