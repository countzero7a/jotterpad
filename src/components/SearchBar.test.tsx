import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { SearchBar } from './SearchBar';

describe('SearchBar', () => {
  it('calls onChange as the user types', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchBar value="" onChange={onChange} />);
    await user.type(screen.getByPlaceholderText('Search notes and events...'), 'milk');
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('displays the current value', () => {
    render(<SearchBar value="milk" onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('milk')).toBeInTheDocument();
  });
});
