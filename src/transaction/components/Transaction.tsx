import { cn } from '../../styles/theme';
import { useIsMounted } from '../../useIsMounted';
import { useOnchainKit } from '../../useOnchainKit';
import { useTheme } from '../../useTheme';
import type { TransactionReact } from '../types';
import { TransactionProvider } from './TransactionProvider';

export function Transaction({
  calls,
  capabilities,
  chainId,
  className,
  children,
  contracts,
  onError,
  onStatus,
  onSuccess,
}: TransactionReact) {
  const isMounted = useIsMounted();
  const componentTheme = useTheme();
  // prevents SSR hydration issue
  if (!isMounted) {
    return null;
  }
  const { chain } = useOnchainKit();

  // If chainId is not provided,
  // use the default chainId from the OnchainKit context
  const accountChainId = chainId ? chainId : chain.id;

  return (
    <TransactionProvider
      calls={calls}
      capabilities={capabilities}
      chainId={accountChainId}
      contracts={contracts}
      onError={onError}
      onStatus={onStatus}
      onSuccess={onSuccess}
    >
      <div
        className={cn(componentTheme, className, 'flex w-full flex-col gap-2')}
      >
        {children}
      </div>
    </TransactionProvider>
  );
}
