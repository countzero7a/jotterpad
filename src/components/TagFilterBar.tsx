interface TagFilterBarProps {
  tags: string[];
  selected: string[];
  onToggle: (tag: string) => void;
}

export function TagFilterBar({ tags, selected, onToggle }: TagFilterBarProps) {
  return (
    <div className="tag-filter-bar">
      {tags.map((tag) => (
        <button
          key={tag}
          className={selected.includes(tag) ? 'tag active' : 'tag'}
          onClick={() => onToggle(tag)}
        >
          #{tag}
        </button>
      ))}
    </div>
  );
}
