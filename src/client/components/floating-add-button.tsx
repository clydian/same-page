import { Plus } from 'lucide-react';
import { Button } from 'react-aria-components';
import { useFloatingVisibility } from '../connection/use-floating-visibility';
import './floating-add-button.css';

export function FloatingAddButton({ label, onPress, disabled, className }: {
  label: string; onPress: () => void; disabled?: boolean; className?: string;
}) {
  const { button, visible } = useFloatingVisibility();
  return <Button ref={button} className={className ? `floating-add-button ${className}` : 'floating-add-button'}
    isDisabled={disabled} aria-label={label} data-visible={visible} inert={!visible} onPress={onPress}>
    <Plus size={28} aria-hidden="true" />
  </Button>;
}
