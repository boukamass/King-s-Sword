import React, { useMemo } from 'react';
import { CitationHighlight } from '../types';
import { PALETTE_HIGHLIGHT_COLORS } from '../constants';
import { splitQuoteIntoHighlightedSegments, HIGHLIGHT_HEX_MAP } from '../utils/highlightUtils';
import { marked } from 'marked';

interface HighlightedQuoteProps {
  quote: string;
  highlights?: CitationHighlight[];
  className?: string;
  isPrint?: boolean;
}

export const HighlightedQuote: React.FC<HighlightedQuoteProps> = ({
  quote,
  highlights,
  className = '',
  isPrint = false
}) => {
  const segments = useMemo(() => {
    return splitQuoteIntoHighlightedSegments(quote, highlights);
  }, [quote, highlights]);

  const formattingClasses = `
    leading-relaxed text-zinc-800 dark:text-zinc-200
    [&_p]:my-2.5 [&_p]:leading-[1.75] [&_p:first-child]:mt-0 [&_p:last-child]:mb-0
    [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-black [&_h1]:text-teal-800 dark:[&_h1]:text-teal-300 [&_h1]:leading-snug
    [&_h2]:mt-3.5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-extrabold [&_h2]:text-teal-700 dark:[&_h2]:text-teal-300 [&_h2]:leading-snug
    [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-teal-700 dark:[&_h3]:text-teal-400 [&_h3]:leading-snug
    [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-3 [&_ul]:space-y-1.5
    [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-3 [&_ol]:space-y-1.5
    [&_li]:my-1 [&_li]:leading-relaxed
    [&_strong]:font-black [&_strong]:text-zinc-900 dark:[&_strong]:text-zinc-100
    [&_em]:italic [&_em]:text-zinc-700 dark:[&_em]:text-zinc-300
    [&_blockquote]:border-l-3 [&_blockquote]:border-teal-500/40 [&_blockquote]:pl-3.5 [&_blockquote]:my-3 [&_blockquote]:italic [&_blockquote]:text-zinc-600 dark:[&_blockquote]:text-zinc-400 [&_blockquote]:leading-relaxed
  `.replace(/\s+/g, ' ').trim();

  if (!highlights || highlights.length === 0 || (segments.length === 1 && !segments[0].isHighlighted)) {
    const parsedHtml = marked.parse(quote || '', { breaks: true }) as string;
    return (
      <span 
        className={`${className} ${formattingClasses} block`}
        dangerouslySetInnerHTML={{ __html: parsedHtml }} 
      />
    );
  }

  return (
    <span className={`${className} ${formattingClasses} block`}>
      {segments.map((seg, idx) => {
        const segHtml = marked.parseInline(seg.text || '', { breaks: true }) as string;
        if (!seg.isHighlighted) {
          return <span key={idx} dangerouslySetInnerHTML={{ __html: segHtml }} />;
        }

        const colorKey = seg.color || 'amber';
        const colorClass = PALETTE_HIGHLIGHT_COLORS[colorKey] || PALETTE_HIGHLIGHT_COLORS['amber'];
        const hexInfo = HIGHLIGHT_HEX_MAP[colorKey] || HIGHLIGHT_HEX_MAP['amber'];

        return (
          <mark
            key={idx}
            className={`${colorClass} px-0.5 py-0.5 rounded-sm font-medium transition-colors text-inherit inline print-highlight`}
            style={{
              backgroundColor: `#${hexInfo.hex || 'FEF08A'}`,
              color: 'inherit',
              WebkitPrintColorAdjust: 'exact',
              printColorAdjust: 'exact'
            }}
            data-tooltip={`Surlignage : ${colorKey}`}
            dangerouslySetInnerHTML={{ __html: segHtml }}
          />
        );
      })}
    </span>
  );
};

export default HighlightedQuote;
