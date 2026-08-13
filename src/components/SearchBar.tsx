interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <input
      className="search-bar"
      type="search"
      placeholder="Search notes and events..."
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
