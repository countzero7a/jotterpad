import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { TagFilterBar } from './TagFilterBar';

describe('TagFilterBar', () => {
  it('renders one button per tag', () => {
    render(<TagFilterBar tags={['idea', 'health']} selected={[]} onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: '#idea' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '#health' })).toBeInTheDocument();
  });

  it('marks selected tags as active', () => {
    render(<TagFilterBar tags={['idea']} selected={['idea']} onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: '#idea' })).toHaveClass('active');
  });

  it('calls onToggle with the clicked tag', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<TagFilterBar tags={['idea']} selected={[]} onToggle={onToggle} />);
    await user.click(screen.getByRole('button', { name: '#idea' }));
    expect(onToggle).toHaveBeenCalledWith('idea');
  });
});
