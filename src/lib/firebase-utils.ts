import {
  DocumentData,
  DocumentReference,
  Firestore,
  writeBatch
} from 'firebase/firestore';
import { auth } from './firebase';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export type ChunkedBatchOperation =
  | { type: 'set'; ref: DocumentReference<DocumentData>; data: DocumentData; merge?: boolean }
  | { type: 'update'; ref: DocumentReference<DocumentData>; data: DocumentData }
  | { type: 'delete'; ref: DocumentReference<DocumentData> };

/**
 * Safely commits any number of Firestore writes by splitting into <= 450-op batches
 * so large CAS/portfolio imports or member migrations never hit Firestore's 500-op batch ceiling.
 */
export async function commitChunkedBatch(
  firestoreDb: Firestore,
  operations: ChunkedBatchOperation[],
  chunkSize = 450
): Promise<void> {
  if (operations.length === 0) return;
  for (let i = 0; i < operations.length; i += chunkSize) {
    const slice = operations.slice(i, i + chunkSize);
    const batch = writeBatch(firestoreDb);
    for (const op of slice) {
      if (op.type === 'set') {
        if (op.merge) batch.set(op.ref, op.data, { merge: true });
        else batch.set(op.ref, op.data);
      } else if (op.type === 'update') {
        batch.update(op.ref, op.data);
      } else if (op.type === 'delete') {
        batch.delete(op.ref);
      }
    }
    await batch.commit();
  }
}
