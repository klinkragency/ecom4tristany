import SegmentForm from '../_forms/SegmentForm';
import { EMPTY_SEGMENT } from '../_forms/shared/types';

export default function NewSegmentPage() {
  return <SegmentForm initial={EMPTY_SEGMENT} mode="create" />;
}
