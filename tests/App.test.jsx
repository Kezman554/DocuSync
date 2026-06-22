import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from '../src/App.jsx';

describe('App', () => {
  it('renders the DocuSync title', () => {
    render(<App />);
    expect(
      screen.getByRole('heading', { name: /docusync/i })
    ).toBeInTheDocument();
  });
});
