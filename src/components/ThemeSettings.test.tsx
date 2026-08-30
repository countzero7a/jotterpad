import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach } from 'vitest';
import { ThemeSettings } from './ThemeSettings';

describe('ThemeSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('renders all four theme options', () => {
    render(<ThemeSettings />);
    expect(screen.getByRole('button', { name: 'Auto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dark' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Blue' })).toBeInTheDocument();
  });

  it('highlights Auto as active by default', () => {
    render(<ThemeSettings />);
    expect(screen.getByRole('button', { name: 'Auto' })).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'Blue' })).not.toHaveClass('active');
  });

  it('applies and persists the selected theme immediately on click', async () => {
    const user = userEvent.setup();
    render(<ThemeSettings />);
    await user.click(screen.getByRole('button', { name: 'Blue' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('blue');
    expect(localStorage.getItem('jotterpad-theme')).toBe('blue');
    expect(screen.getByRole('button', { name: 'Blue' })).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'Auto' })).not.toHaveClass('active');
  });

  it('reflects an already-stored theme on mount', () => {
    localStorage.setItem('jotterpad-theme', 'dark');
    render(<ThemeSettings />);
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveClass('active');
  });
});
