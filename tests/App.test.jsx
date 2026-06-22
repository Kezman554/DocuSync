import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from '../src/App.jsx';

describe('App layout', () => {
  it('renders the DocuSync brand in the toolbar', () => {
    render(<App />);
    expect(screen.getByText('DocuSync')).toBeInTheDocument();
  });

  it('shows the empty state prompting the user to open a PDF', () => {
    render(<App />);
    expect(
      screen.getByRole('heading', { name: /open a pdf to get started/i })
    ).toBeInTheDocument();
  });

  it('renders the core layout regions', () => {
    render(<App />);
    expect(screen.getByRole('banner')).toBeInTheDocument(); // toolbar <header>
    expect(
      screen.getByRole('complementary', { name: /page thumbnails/i })
    ).toBeInTheDocument(); // sidebar <aside>
    expect(
      screen.getByRole('region', { name: /document viewer/i })
    ).toBeInTheDocument(); // viewer <section>
  });
});
