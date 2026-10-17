import { useState } from 'react';
import { navigate } from '../hooks/useScreen';
import { PROLOGUE } from '../story/chapters';
import { StoryScene } from './StoryScene';
export function PrologueScreen() {
  const [page, setPage] = useState(0);
  const chapter = PROLOGUE[page]!;
  return <StoryScene key={page} title={chapter.title} paragraphs={chapter.text} chapter="Prologue · A crack in the mirror"
    page={`${page + 1} / ${PROLOGUE.length}`} action={page === 0 ? 'An evil… me?' : 'Let the story know my name'}
    onContinue={() => page === 0 ? setPage(1) : navigate('login')} />;
}
