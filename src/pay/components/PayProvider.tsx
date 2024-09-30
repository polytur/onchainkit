import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ContractFunctionParameters } from 'viem';
import { base } from 'viem/chains';
import { useAccount, useConnect, useSwitchChain } from 'wagmi';
import { useWaitForTransactionReceipt } from 'wagmi';
import { coinbaseWallet } from 'wagmi/connectors';
import { useWriteContracts } from 'wagmi/experimental';
import { useCallsStatus } from 'wagmi/experimental';
import { useValue } from '../../internal/hooks/useValue';
import {
  GENERIC_ERROR_MESSAGE,
  USER_REJECTED_ERROR,
} from '../../transaction/constants';
import { isUserRejectedRequestError } from '../../transaction/utils/isUserRejectedRequestError';
import {
  PAY_INSUFFICIENT_BALANCE_ERROR,
  PAY_INSUFFICIENT_BALANCE_ERROR_MESSAGE,
  PAY_LIFECYCLESTATUS,
  PayErrorCode,
} from '../constants';
import { useCommerceContracts } from '../hooks/useCommerceContracts';
import { useLifecycleStatus } from '../hooks/useLifecycleStatus';
import type { LifecycleStatus } from '../types';

type PayContextType = {
  errorMessage?: string;
  lifeCycleStatus?: LifecycleStatus;
  onSubmit: () => void;
  updateLifecycleStatus: (status: LifecycleStatus) => void;
};

const emptyContext = {} as PayContextType;
export const PayContext = createContext<PayContextType>(emptyContext);

export function usePayContext() {
  const context = useContext(PayContext);
  if (context === emptyContext) {
    throw new Error('usePayContext must be used within a Pay component');
  }
  return context;
}

type PayProviderProps = {
  chargeHandler?: () => Promise<string>;
  children: React.ReactNode;
  className?: string;
  onStatus?: (status: LifecycleStatus) => void;
  productId?: string;
};

export function PayProvider({
  chargeHandler,
  children,
  className,
  onStatus,
  productId,
}: PayProviderProps) {
  // Core hooks
  const { address, chainId, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect({
    mutation: {
      onSuccess: async () => {
        await fetchContracts();
      },
    },
  });
  const { switchChainAsync } = useSwitchChain();
  const chargeIdRef = useRef<string | undefined>(undefined);
  const contractsRef = useRef<ContractFunctionParameters[] | undefined>(
    undefined,
  );
  const userHasInsufficientBalanceRef = useRef<boolean>(false);
  const [transactionId, setTransactionId] = useState('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Component lifecycle
  const [lifeCycleStatus, updateLifecycleStatus] = useLifecycleStatus({
    statusName: PAY_LIFECYCLESTATUS.INIT,
    statusData: {},
  });

  // Transaction hooks
  const fetchContracts = useCommerceContracts({
    address,
    chargeIdRef,
    contractsRef,
    chargeHandler,
    productId,
    setErrorMessage,
    userHasInsufficientBalanceRef,
  });
  const { status, writeContractsAsync } = useWriteContracts({
    mutation: {
      onSuccess: (id) => {
        setTransactionId(id);
      },
      onError: (e) => {
        const errorMessage = isUserRejectedRequestError(e)
          ? 'Request denied.'
          : GENERIC_ERROR_MESSAGE;
        updateLifecycleStatus({
          statusName: PAY_LIFECYCLESTATUS.ERROR,
          statusData: {
            code: 'PmUWCSh01', // Transaction module UseWriteContracts hook 01 error
            error: e.message,
            message: errorMessage,
          },
        });
      },
    },
  });
  const { data } = useCallsStatus({
    id: transactionId,
    query: {
      refetchInterval: (query) => {
        return query.state.data?.status === 'CONFIRMED' ? false : 1000;
      },
      enabled: !!transactionId,
    },
  });
  const transactionHash = data?.receipts?.[0]?.transactionHash;

  const { data: receipt } = useWaitForTransactionReceipt({
    hash: transactionHash,
  });

  // Component lifecycle emitters
  useEffect(() => {
    // Emit Status
    onStatus?.(lifeCycleStatus);
  }, [
    lifeCycleStatus,
    lifeCycleStatus.statusData, // Keep statusData, so that the effect runs when it changes
    lifeCycleStatus.statusName, // Keep statusName, so that the effect runs when it changes
    onStatus,
  ]);

  // Set transaction pending status when writeContracts is pending
  useEffect(() => {
    if (status === 'pending') {
      updateLifecycleStatus({
        statusName: PAY_LIFECYCLESTATUS.PENDING,
        statusData: {},
      });
    }
  }, [status, updateLifecycleStatus]);
  // Trigger success status when receipt is generated by useWaitForTransactionReceipt
  useEffect(() => {
    if (!receipt) {
      return;
    }
    updateLifecycleStatus({
      statusName: PAY_LIFECYCLESTATUS.SUCCESS,
      statusData: {
        transactionReceipts: [receipt],
        chargeId: chargeIdRef.current ?? '',
        receiptUrl: `https://commerce.coinbase.com/pay/${chargeIdRef.current}/receipt`,
      },
    });
  }, [receipt, updateLifecycleStatus]);

  const handleSubmit = useCallback(async () => {
    try {
      if (lifeCycleStatus.statusName === PAY_LIFECYCLESTATUS.SUCCESS) {
        // Open Coinbase Commerce receipt
        window.open(
          `https://commerce.coinbase.com/pay/${chargeIdRef.current}/receipt`,
          '_blank',
          'noopener,noreferrer',
        );
        return;
      }
      if (
        lifeCycleStatus.statusName === PAY_LIFECYCLESTATUS.ERROR &&
        lifeCycleStatus.statusData?.code === PayErrorCode.INSUFFICIENT_BALANCE
      ) {
        window.open(
          'https://keys.coinbase.com/fund',
          '_blank',
          'noopener,noreferrer',
        );
        return;
      }

      if (chainId !== base.id) {
        await switchChainAsync({ chainId: base.id });
      }

      if (isConnected) {
        // Fetch contracts
        await fetchContracts();
      } else {
        // Prompt for wallet connection
        // This is defaulted to Coinbase Smart Wallet
        await connectAsync({
          connector:
            connectors.find(
              (connector) => connector.id === 'coinbaseWalletSDK',
            ) || coinbaseWallet({ preference: 'smartWalletOnly' }),
        });
      }

      // Check for enough balance
      if (userHasInsufficientBalanceRef.current) {
        setErrorMessage(PAY_INSUFFICIENT_BALANCE_ERROR_MESSAGE);
        updateLifecycleStatus({
          statusName: PAY_LIFECYCLESTATUS.ERROR,
          statusData: {
            code: PayErrorCode.INSUFFICIENT_BALANCE,
            error: PAY_INSUFFICIENT_BALANCE_ERROR,
            message: PAY_INSUFFICIENT_BALANCE_ERROR_MESSAGE,
          },
        });
        return;
      }

      if (contractsRef.current) {
        await writeContractsAsync({
          contracts: contractsRef.current,
        });
      } else {
        setErrorMessage(GENERIC_ERROR_MESSAGE);
        updateLifecycleStatus({
          statusName: PAY_LIFECYCLESTATUS.ERROR,
          statusData: {
            code: PayErrorCode.UNEXPECTED_ERROR,
            error: 'Contracts are not available',
            message: GENERIC_ERROR_MESSAGE,
          },
        });
      }
    } catch (error) {
      if (isUserRejectedRequestError(error)) {
        setErrorMessage(USER_REJECTED_ERROR);
      } else {
        setErrorMessage(GENERIC_ERROR_MESSAGE);
        updateLifecycleStatus({
          statusName: PAY_LIFECYCLESTATUS.ERROR,
          statusData: {
            code: PayErrorCode.UNEXPECTED_ERROR,
            error: JSON.stringify(error),
            message: GENERIC_ERROR_MESSAGE,
          },
        });
      }
    }
  }, [
    chainId,
    connectAsync,
    connectors,
    fetchContracts,
    isConnected,
    lifeCycleStatus.statusData,
    lifeCycleStatus.statusName,
    switchChainAsync,
    updateLifecycleStatus,
    writeContractsAsync,
  ]);

  const value = useValue({
    errorMessage,
    lifeCycleStatus,
    onSubmit: handleSubmit,
    updateLifecycleStatus,
  });
  return <PayContext.Provider value={value}>{children}</PayContext.Provider>;
}
