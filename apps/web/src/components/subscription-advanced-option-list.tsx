import { useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import {
  getAdvancedOptionListSearchResults,
  getAdvancedOptionListSections,
  type SubscriptionAdvancedFilterOption,
} from "@/modules/subscriptions/domain/subscription-advanced-filter-options";

type AdvancedOptionListLayout = "desktop" | "mobile";

interface AdvancedOptionListProps<T extends string = string> {
  options: Array<SubscriptionAdvancedFilterOption<T>>;
  selectedValues: T[];
  onChange: (values: T[]) => void;
  layout: AdvancedOptionListLayout;
  searchPlaceholder: string;
  emptyMessage: string;
  searchResultsLabel: string;
  allOptionsLabel: string;
  alwaysShowSearch?: boolean;
  searchThreshold?: number;
  testId: string;
}

function toggleValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function AdvancedOptionRow<T extends string>({
  option,
  selected,
  layout,
  onToggle,
}: {
  option: SubscriptionAdvancedFilterOption<T>;
  selected: boolean;
  layout: AdvancedOptionListLayout;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      className={cn(
        "flex w-full min-w-0 items-center gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
        layout === "mobile" ? "min-h-12" : "min-h-11",
        selected
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border bg-secondary/50 text-foreground hover:border-primary/50 hover:bg-secondary/70",
      )}
      onClick={onToggle}
    >
      <span
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50 bg-background/40",
        )}
        aria-hidden="true"
      >
        {selected ? <Check className="h-3.5 w-3.5" /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{option.label}</span>
    </button>
  );
}

function OptionSection<T extends string>({
  label,
  options,
  selectedValues,
  layout,
  onToggle,
  testId,
}: {
  label?: string | undefined;
  options: Array<SubscriptionAdvancedFilterOption<T>>;
  selectedValues: T[];
  layout: AdvancedOptionListLayout;
  onToggle: (value: T) => void;
  testId: string;
}) {
  if (options.length === 0) return null;

  return (
    <section className="space-y-2" data-testid={testId}>
      {label ? <h3 className="px-1 text-xs font-medium text-muted-foreground">{label}</h3> : null}
      <div className="flex flex-col gap-2">
        {options.map((option) => (
          <AdvancedOptionRow
            key={option.value}
            option={option}
            selected={selectedValues.includes(option.value)}
            layout={layout}
            onToggle={() => onToggle(option.value)}
          />
        ))}
      </div>
    </section>
  );
}

export function AdvancedOptionList<T extends string = string>({
  options,
  selectedValues,
  onChange,
  layout,
  searchPlaceholder,
  emptyMessage,
  searchResultsLabel,
  allOptionsLabel,
  alwaysShowSearch = false,
  searchThreshold = 12,
  testId,
}: AdvancedOptionListProps<T>) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const trimmedSearch = search.trim();
  const showSearch = alwaysShowSearch || options.length > searchThreshold;
  // 选择器要保持设置页同款单一顺序；已选项只在原行标记，不能再抽成置顶分组打断扫描。
  const sections = useMemo(() => getAdvancedOptionListSections({
    options,
  }), [options]);
  const searchResults = useMemo(() => {
    if (!trimmedSearch) return [];
    // 搜索只过滤完整候选集，选中集合仍由父级草稿保存，避免输入关键词时隐式改掉筛选条件。
    return getAdvancedOptionListSearchResults({
      options,
      searchQuery: search,
    });
  }, [options, search, trimmedSearch]);
  const handleToggle = (value: T) => onChange(toggleValue(selectedValues, value));

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={testId}>
      {showSearch ? (
        // 搜索框是 H5 长列表的固定控制区；只有候选列表滚动，避免用户翻到中段后丢失筛选入口。
        <div className="shrink-0 px-5 pb-3 pt-4" data-testid={`${testId}-search`}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className={cn("border-border bg-secondary pl-9 pr-10", layout === "mobile" ? "h-11" : "h-10")}
            />
            {trimmedSearch ? (
              <button
                type="button"
                aria-label={t("subscriptions.advanced.clearSearch")}
                className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                onClick={() => setSearch("")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        className={cn("min-h-0 flex-1 overflow-y-auto px-5", showSearch ? "pb-4" : "py-4")}
        data-testid={`${testId}-options-scroll`}
      >
        {trimmedSearch ? (
          searchResults.length > 0 ? (
            <OptionSection
              label={searchResultsLabel}
              options={searchResults}
              selectedValues={selectedValues}
              layout={layout}
              onToggle={handleToggle}
              testId={`${testId}-search-results`}
            />
          ) : (
            <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-border bg-secondary/40 px-4 text-center text-sm text-muted-foreground">
              {emptyMessage}
            </div>
          )
        ) : (
          <OptionSection
            label={allOptionsLabel}
            options={sections.allOptions}
            selectedValues={selectedValues}
            layout={layout}
            onToggle={handleToggle}
            testId={`${testId}-all-options`}
          />
        )}
      </div>
    </div>
  );
}
