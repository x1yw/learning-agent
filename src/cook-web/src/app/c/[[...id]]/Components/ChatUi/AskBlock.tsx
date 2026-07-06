import React, {
  useState,
  useRef,
  useCallback,
  useContext,
  useEffect,
} from 'react';
import { cn } from '@/lib/utils';
import { lessonFeedbackInteractionDefaultValueOptions } from '@/c-utils/lesson-feedback-interaction-defaults';
import { useTranslation } from 'react-i18next';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { ContentRender, MarkdownFlowInput } from 'markdown-flow-ui/renderer';
import {
  getLearnerAskImageRefs,
  getRunMessage,
  SSE_INPUT_TYPE,
  SSE_OUTPUT_TYPE,
} from '@/c-api/studyV2';
import type { LearnerAskImageRef } from '@/c-api/studyV2';
import { fixMarkdownStream } from '@/c-utils/markdownUtils';
import LoadingBar from './LoadingBar';
import StreamingLoadingDotsBar from './StreamingLoadingDotsBar';
import styles from './AskBlock.module.scss';
import { toast } from '@/hooks/useToast';
import { ToastAction } from '@/components/ui/Toast';
import { AppContext } from '../AppContext';
import { BLOCK_TYPE } from '@/c-api/studyV2';
import { Avatar, AvatarImage } from '@/components/ui/Avatar';
import { useCourseStore } from '@/c-store/useCourseStore';
import {
  EMPTY_ASK_MESSAGE_LIST,
  normalizeAskMessageList,
  type AskMessage,
} from './askState';
import { useAskStateStore } from './useAskStateStore';
import { CHAT_TYPEWRITER_SPEED_MS } from '@/c-constants/uiConstants';
export type { AskMessage } from './askState';

const ASK_IMAGE_POLL_INTERVAL_MS = 3000;
const ASK_IMAGE_ESTIMATED_SECONDS = 180;
const ASK_IMAGE_TERMINAL_STATUSES = new Set([
  'ready',
  'reused',
  'failed',
  'skipped',
]);
const ASK_ANSWER_BLOCK_TAG_PATTERN =
  /<(iframe|img|svg|canvas|video|style|script)\b[\s\S]*?<\/\1>|<(iframe|img|svg|canvas|video)\b[^>]*\/?>/gi;
const ASK_ANSWER_HTML_CONTAINER_PATTERN =
  /<([a-z][\w:-]*)\b[^>]*(style|class)=["'][^"']*(background|content-render|iframe|slide|visual)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi;
const ASK_ANSWER_MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*]\([^)]+\)/g;

export interface AskBlockProps {
  askList?: AskMessage[];
  className?: string;
  isExpanded?: boolean;
  forceDesktopSlidePanel?: boolean;
  shifu_bid: string;
  outline_bid: string;
  preview_mode?: boolean;
  element_bid: string;
  onToggleAskExpanded?: (element_bid: string) => void;
}

/**
 * AskBlock
 * Follow-up area component that contains the Q&A list and custom input box with streaming support
 */
export default function AskBlock({
  askList = [],
  className,
  isExpanded = undefined,
  forceDesktopSlidePanel = false,
  shifu_bid,
  outline_bid,
  preview_mode = false,
  element_bid,
  onToggleAskExpanded,
}: AskBlockProps) {
  const { t } = useTranslation();
  const copyButtonText = t('module.renderUi.core.copyCode');
  const copiedButtonText = t('module.renderUi.core.copied');
  const { mobileStyle } = useContext(AppContext);
  const courseAvatar = useCourseStore(state => state.courseAvatar);
  const ensureLessonScope = useAskStateStore(state => state.ensureLessonScope);
  const hydrateAskList = useAskStateStore(state => state.hydrateAskList);
  const setAskList = useAskStateStore(state => state.setAskList);
  const lessonScopeKey = useAskStateStore(state => state.lessonScopeKey);
  const scopedAskListByAnchorElementBid = useAskStateStore(
    state => state.askListByAnchorElementBid,
  );
  const storedAskList =
    lessonScopeKey === outline_bid
      ? (scopedAskListByAnchorElementBid[element_bid] ?? EMPTY_ASK_MESSAGE_LIST)
      : EMPTY_ASK_MESSAGE_LIST;
  const displayList =
    storedAskList.length || !askList.length
      ? storedAskList
      : normalizeAskMessageList(askList);
  const hasDisplayMessages = displayList.length > 0;
  const hasStreamingAnswerTypewriterMessage = displayList.some(
    item =>
      item.type === BLOCK_TYPE.ANSWER &&
      item.isStreaming === true &&
      item.shouldUseTypewriter === true,
  );

  const [inputValue, setInputValue] = useState('');
  const sseRef = useRef<any>(null);
  const currentContentRef = useRef<string>('');
  const currentAnswerElementBidRef = useRef<string>('');
  const notifiedReadyImageRefs = useRef<Set<string>>(new Set());
  const requestedImageAnswerBids = useRef<Set<string>>(new Set());
  const isStreamingRef = useRef(false);
  const [askImageNowMs, setAskImageNowMs] = useState(() => Date.now());
  const [highlightedImageRefBid, setHighlightedImageRefBid] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showMobileDialog, setShowMobileDialog] = useState(hasDisplayMessages);
  const mobileContentRef = useRef<HTMLDivElement | null>(null);
  const inputWrapperRef = useRef<HTMLDivElement | null>(null);
  const isSlideAskBlock = className?.includes('listen-slide-ask-block');
  const isDesktopSlideAskBlock = Boolean(isSlideAskBlock) && !mobileStyle;
  const isLandscapeSlideMobileDialog =
    Boolean(isSlideAskBlock) && mobileStyle && forceDesktopSlidePanel;
  const expanded = isExpanded ?? (!mobileStyle && hasDisplayMessages);
  const expandedRef = useRef(expanded);
  const previousExpandedRef = useRef(expanded);
  const shouldForceSlideMobileDialog =
    Boolean(isSlideAskBlock) && mobileStyle && expanded;
  const shouldShowMobileDialog =
    showMobileDialog || shouldForceSlideMobileDialog;
  const showOutputInProgressToast = useCallback(() => {
    toast({
      title: t('module.chat.outputInProgress'),
    });
  }, [t]);
  const sanitizeAskAnswerContent = useCallback((content: string) => {
    return String(content || '')
      .replace(ASK_ANSWER_BLOCK_TAG_PATTERN, '')
      .replace(ASK_ANSWER_HTML_CONTAINER_PATTERN, '')
      .replace(ASK_ANSWER_MARKDOWN_IMAGE_PATTERN, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }, []);
  const scrollToAskImageRef = useCallback(
    (refBid: string) => {
      if (!refBid || typeof document === 'undefined') {
        return;
      }

      setShowMobileDialog(true);
      if (!expandedRef.current) {
        onToggleAskExpanded?.(element_bid);
      }

      setHighlightedImageRefBid(refBid);
      window.setTimeout(() => {
        const target = document.getElementById(`ask-image-${refBid}`);
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 120);
      window.setTimeout(() => {
        setHighlightedImageRefBid(current =>
          current === refBid ? '' : current,
        );
      }, 3200);
    },
    [element_bid, onToggleAskExpanded],
  );
  const mergeImageRefsIntoAnswer = useCallback(
    (answerElementBid: string, imageRefs: LearnerAskImageRef[]) => {
      if (!answerElementBid) {
        return;
      }
      setAskList(element_bid, prev => {
        let hasChanges = false;
        const nextList = prev.map(item => {
          if (
            item.type !== BLOCK_TYPE.ANSWER ||
            item.element_bid !== answerElementBid
          ) {
            return item;
          }
          hasChanges = true;
          return {
            ...item,
            imageRefs,
          };
        });
        return hasChanges ? nextList : prev;
      });
    },
    [element_bid, setAskList],
  );

  const fetchImageRefsForAnswer = useCallback(
    async (answerElementBid: string) => {
      if (!answerElementBid) {
        return [];
      }
      try {
        const refs = await getLearnerAskImageRefs({
          shifu_bid,
          answer_element_bid: answerElementBid,
          preview_mode,
        });
        const imageRefs = Array.isArray(refs) ? refs : [];
        mergeImageRefsIntoAnswer(answerElementBid, imageRefs);
        imageRefs.forEach(ref => {
          const isReady =
            (ref.status === 'ready' || ref.status === 'reused') &&
            Boolean(ref.asset?.url);
          if (!isReady || notifiedReadyImageRefs.current.has(ref.ref_bid)) {
            return;
          }
          notifiedReadyImageRefs.current.add(ref.ref_bid);
          toast({
            title: t('module.chat.askImageReady'),
            action: (
              <ToastAction
                altText={t('module.chat.askImageJump')}
                onClick={() => scrollToAskImageRef(ref.ref_bid)}
              >
                {t('module.chat.askImageJump')}
              </ToastAction>
            ),
            duration: 10000,
          });
        });
        return imageRefs;
      } catch {
        return [];
      }
    },
    [mergeImageRefsIntoAnswer, preview_mode, scrollToAskImageRef, shifu_bid, t],
  );
  const dismissAskInputFocus = useCallback(() => {
    if (!mobileStyle || typeof document === 'undefined') {
      return;
    }

    const focusable =
      inputWrapperRef.current?.querySelector<
        HTMLTextAreaElement | HTMLInputElement | HTMLElement
      >('textarea, input, [contenteditable="true"]') ?? null;
    const activeElement = document.activeElement as HTMLElement | null;
    const shouldBlurActiveElement =
      Boolean(activeElement) &&
      inputWrapperRef.current?.contains(activeElement);

    requestAnimationFrame(() => {
      if (shouldBlurActiveElement) {
        activeElement?.blur();
        return;
      }

      focusable?.blur();
    });
  }, [mobileStyle]);

  const finalizeStreamingMessage = useCallback(() => {
    isStreamingRef.current = false;
    setAskList(element_bid, prev => {
      const newList = [...prev];
      const lastIndex = newList.length - 1;
      if (lastIndex >= 0 && newList[lastIndex].type === BLOCK_TYPE.ANSWER) {
        newList[lastIndex] = {
          ...newList[lastIndex],
          isStreaming: false,
          shouldUseTypewriter: expandedRef.current
            ? newList[lastIndex].shouldUseTypewriter
            : false,
        };
      }
      return newList;
    });
  }, [element_bid, setAskList]);

  const updateStreamingAnswerMessage = useCallback(
    (incomingText: string) => {
      const prevText = currentContentRef.current || '';
      const delta = fixMarkdownStream(prevText, incomingText || '');
      const nextText = prevText + delta;
      currentContentRef.current = nextText;

      setAskList(element_bid, prev => {
        const newList = [...prev];
        const lastIndex = newList.length - 1;
        if (lastIndex >= 0 && newList[lastIndex].type === BLOCK_TYPE.ANSWER) {
          newList[lastIndex] = {
            ...newList[lastIndex],
            content: nextText,
            isStreaming: true,
            shouldUseTypewriter: newList[lastIndex].shouldUseTypewriter ?? true,
          };
        }
        return newList;
      });
    },
    [element_bid, setAskList],
  );

  const replaceStreamingAnswerMessage = useCallback(
    (incomingText: string, answerElementBid = '') => {
      const nextText = incomingText || '';
      currentContentRef.current = nextText;
      if (answerElementBid) {
        currentAnswerElementBidRef.current = answerElementBid;
      }

      setAskList(element_bid, prev => {
        const newList = [...prev];
        const lastIndex = newList.length - 1;
        if (lastIndex >= 0 && newList[lastIndex].type === BLOCK_TYPE.ANSWER) {
          newList[lastIndex] = {
            ...newList[lastIndex],
            content: nextText,
            isStreaming: true,
            element_bid: answerElementBid || newList[lastIndex].element_bid,
            shouldUseTypewriter: newList[lastIndex].shouldUseTypewriter ?? true,
          };
        }
        return newList;
      });
    },
    [element_bid, setAskList],
  );

  const handleSendCustomQuestion = useCallback(async () => {
    const question = inputValue.trim();
    if (isStreamingRef.current) {
      showOutputInProgressToast();
      return;
    }

    if (!question) {
      return;
    }

    // Close any previous SSE connection
    sseRef.current?.close();
    setShowMobileDialog(true);

    // Append the new question as a user message at the end
    setAskList(element_bid, prev => [
      ...prev,
      {
        type: BLOCK_TYPE.ASK,
        content: question,
      },
    ]);

    setInputValue('');
    dismissAskInputFocus();

    // Add an empty teacher reply placeholder to receive streaming content
    setAskList(element_bid, prev => [
      ...prev,
      {
        type: BLOCK_TYPE.ANSWER,
        content: '',
        isStreaming: true,
        element_bid: '',
        shouldUseTypewriter: true,
      },
    ]);

    // Reset the streaming content buffer
    currentContentRef.current = '';
    currentAnswerElementBidRef.current = '';
    isStreamingRef.current = true;

    // Initiate the SSE request
    const source = getRunMessage(
      shifu_bid,
      outline_bid,
      preview_mode,
      {
        input: question,
        input_type: SSE_INPUT_TYPE.ASK,
        reload_generated_block_bid: element_bid,
        reload_element_bid: element_bid,
        listen: false,
      },
      async response => {
        try {
          if (response.type === SSE_OUTPUT_TYPE.HEARTBEAT) {
            return;
          }

          if (response.type === SSE_OUTPUT_TYPE.ERROR) {
            // Backend rejected the ask (commonly the parallel-ask semaphore
            // was full, see runscript_v2._ask_sem_acquire). The ask is not
            // persisted, so a stale placeholder would survive a page reload
            // as a question without an answer. Roll back the local ASK +
            // ANSWER we appended before opening the SSE, restore the user's
            // text so they can retry, and surface the backend's localized
            // reason via toast.
            setAskList(element_bid, prev => {
              const next = [...prev];
              if (
                next.length &&
                next[next.length - 1].type === BLOCK_TYPE.ANSWER
              ) {
                next.pop();
              }
              if (
                next.length &&
                next[next.length - 1].type === BLOCK_TYPE.ASK
              ) {
                next.pop();
              }
              return next;
            });
            setInputValue(question);

            const backendMessage =
              typeof response.content === 'string' ? response.content : '';
            toast({
              title: backendMessage || t('module.chat.outputInProgress'),
            });

            isStreamingRef.current = false;
            sseRef.current?.close();
            return;
          }

          if (response.type === SSE_OUTPUT_TYPE.CONTENT) {
            updateStreamingAnswerMessage(response.content || '');
            return;
          }

          if (response.type === SSE_OUTPUT_TYPE.ELEMENT) {
            const elementRecord =
              response.content && typeof response.content === 'object'
                ? response.content
                : null;
            const elementType =
              typeof elementRecord?.element_type === 'string'
                ? elementRecord.element_type
                : '';

            if (elementType === BLOCK_TYPE.ANSWER) {
              const answerElementBid =
                typeof elementRecord?.target_element_bid === 'string' &&
                elementRecord.target_element_bid
                  ? elementRecord.target_element_bid
                  : typeof elementRecord?.element_bid === 'string'
                    ? elementRecord.element_bid
                    : '';
              const answerText =
                typeof elementRecord?.content === 'string'
                  ? elementRecord.content
                  : '';

              replaceStreamingAnswerMessage(answerText, answerElementBid);
              return;
            }
          }

          if (response.type === SSE_OUTPUT_TYPE.BREAK) {
            return;
          }

          if (response.type === SSE_OUTPUT_TYPE.TEXT_END) {
            if (response.is_terminal !== true) {
              return;
            }

            finalizeStreamingMessage();
            const answerElementBid = currentAnswerElementBidRef.current;
            if (answerElementBid) {
              void fetchImageRefsForAnswer(answerElementBid);
            }
            sseRef.current?.close();
            return;
          }
        } catch {
          finalizeStreamingMessage();
        }
      },
    );

    // Add error and close listeners to ensure the state resets
    source.addEventListener('error', () => {
      finalizeStreamingMessage();
    });

    source.addEventListener('readystatechange', () => {
      // readyState: 0=CONNECTING, 1=OPEN, 2=CLOSED
      if (source.readyState === 1) {
        isStreamingRef.current = true;
      } else if (source.readyState === 2) {
        finalizeStreamingMessage();
      }
    });

    sseRef.current = source;
  }, [
    shifu_bid,
    outline_bid,
    preview_mode,
    element_bid,
    inputValue,
    dismissAskInputFocus,
    showOutputInProgressToast,
    finalizeStreamingMessage,
    fetchImageRefsForAnswer,
    replaceStreamingAnswerMessage,
    setAskList,
    updateStreamingAnswerMessage,
    t,
  ]);
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputValue(e.target.value);
    },
    [],
  );

  // Decide which messages to display
  const messagesToShow = expanded ? displayList : displayList.slice(0, 1);
  const hasAskAnswerMessages = messagesToShow.length > 0;
  const shouldRenderMobileDialog =
    mobileStyle &&
    shouldShowMobileDialog &&
    (hasAskAnswerMessages || shouldForceSlideMobileDialog);
  const hasGeneratingAskImage = displayList.some(message =>
    (message.imageRefs ?? []).some(
      ref =>
        ref.status !== 'skipped' && !ASK_IMAGE_TERMINAL_STATUSES.has(ref.status),
    ),
  );

  useEffect(() => {
    ensureLessonScope(outline_bid);
  }, [ensureLessonScope, outline_bid]);

  useEffect(() => {
    hydrateAskList(element_bid, askList);
  }, [askList, element_bid, hydrateAskList]);

  useEffect(() => {
    if (!expanded) {
      setIsFullscreen(false);
    }
  }, [expanded]);

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  useEffect(() => {
    const previousExpanded = previousExpandedRef.current;
    previousExpandedRef.current = expanded;

    if (previousExpanded === expanded) {
      return;
    }

    // Expanding the sheet should not cancel an active answer typewriter session.
    if (expanded) {
      return;
    }

    setAskList(element_bid, prev => {
      let hasChanges = false;
      const nextList = prev.map(item => {
        if (
          item.type !== BLOCK_TYPE.ANSWER ||
          item.shouldUseTypewriter !== true ||
          item.isStreaming === true
        ) {
          return item;
        }

        hasChanges = true;
        return {
          ...item,
          shouldUseTypewriter: false,
        };
      });

      return hasChanges ? nextList : prev;
    });
  }, [element_bid, expanded, setAskList]);

  useEffect(() => {
    return () => {
      sseRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (hasDisplayMessages) {
      setShowMobileDialog(true);
    }
  }, [hasDisplayMessages]);

  useEffect(() => {
    if (!hasGeneratingAskImage) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setAskImageNowMs(Date.now());
    }, 1000);
    setAskImageNowMs(Date.now());
    return () => window.clearInterval(intervalId);
  }, [hasGeneratingAskImage]);

  useEffect(() => {
    const uncheckedAnswerElementBids = displayList
      .filter(
        message =>
          message.type === BLOCK_TYPE.ANSWER &&
          !message.isStreaming &&
          Boolean(message.element_bid) &&
          message.imageRefs === undefined &&
          !requestedImageAnswerBids.current.has(message.element_bid as string),
      )
      .map(message => message.element_bid as string);
    uncheckedAnswerElementBids.forEach(answerElementBid => {
      requestedImageAnswerBids.current.add(answerElementBid);
      void fetchImageRefsForAnswer(answerElementBid);
    });

    const answerElementBids = displayList
      .filter(
        message =>
          message.type === BLOCK_TYPE.ANSWER &&
          !message.isStreaming &&
          Boolean(message.element_bid) &&
          (message.imageRefs ?? []).some(
            ref => !ASK_IMAGE_TERMINAL_STATUSES.has(ref.status),
          ),
      )
      .map(message => message.element_bid as string);

    if (!answerElementBids.length) {
      return;
    }

    const poll = () => {
      answerElementBids.forEach(answerElementBid => {
        void fetchImageRefsForAnswer(answerElementBid);
      });
    };
    const intervalId = window.setInterval(poll, ASK_IMAGE_POLL_INTERVAL_MS);
    poll();
    return () => window.clearInterval(intervalId);
  }, [displayList, fetchImageRefsForAnswer]);

  useEffect(() => {
    if (!shouldRenderMobileDialog || !expanded) {
      return;
    }

    if (typeof document === 'undefined') {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [expanded, shouldRenderMobileDialog]);

  useEffect(() => {
    if (!mobileStyle || !shouldShowMobileDialog || !expanded) {
      return;
    }

    const container = mobileContentRef.current;
    if (!container) {
      return;
    }

    const syncScrollToBottom = () => {
      container.scrollTop = container.scrollHeight;
    };
    const rafId = requestAnimationFrame(syncScrollToBottom);
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(syncScrollToBottom);
    });

    resizeObserver.observe(container);
    Array.from(container.children).forEach(child => {
      resizeObserver.observe(child);
    });

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [mobileStyle, shouldShowMobileDialog, expanded, messagesToShow]);

  useEffect(() => {
    if (!isDesktopSlideAskBlock || !expanded) {
      return;
    }

    const container = mobileContentRef.current;
    if (!container) {
      return;
    }

    const syncScrollToBottom = () => {
      container.scrollTop = container.scrollHeight;
    };
    const rafId = requestAnimationFrame(syncScrollToBottom);
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(syncScrollToBottom);
    });

    resizeObserver.observe(container);
    Array.from(container.children).forEach(child => {
      resizeObserver.observe(child);
    });

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [expanded, isDesktopSlideAskBlock, messagesToShow]);

  const handleClose = useCallback(() => {
    setIsFullscreen(false);
    // onClose?.();
    onToggleAskExpanded?.(element_bid);
  }, [onToggleAskExpanded, element_bid]);

  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  const focusAskInput = useCallback(() => {
    // Auto focus the follow-up textarea so the cursor is ready after expanding
    // if (!inputWrapperRef.current) {
    //   return null;
    // }
    // const focusable = inputWrapperRef.current.querySelector<
    //   HTMLTextAreaElement | HTMLInputElement | HTMLElement
    // >('textarea, input, [contenteditable="true"]');
    // if (focusable && typeof focusable.focus === 'function') {
    //   return requestAnimationFrame(() => {
    //     focusable.focus({ preventScroll: true });
    //   });
    // }
    // return null;
  }, []);

  useEffect(() => {
    if (!expanded) {
      return;
    }
    const rafId = focusAskInput() ?? null;
    return () => {
      // Cancel RAF to avoid focusing after unmount or quick collapse
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [expanded, focusAskInput]);

  const handleClickTitle = useCallback(
    (index: number) => {
      if (index !== 0 || expanded || !mobileStyle) {
        return;
      }
      onToggleAskExpanded?.(element_bid);
    },
    [onToggleAskExpanded, element_bid, expanded, mobileStyle],
  );

  const formatAskImageEta = useCallback(
    (ref: LearnerAskImageRef) => {
      const createdMs = ref.created_at ? Date.parse(ref.created_at) : NaN;
      const elapsedSeconds = Number.isFinite(createdMs)
        ? Math.max(0, Math.floor((askImageNowMs - createdMs) / 1000))
        : 0;
      const remainingSeconds = Math.max(
        0,
        ASK_IMAGE_ESTIMATED_SECONDS - elapsedSeconds,
      );
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = remainingSeconds % 60;

      return {
        minutes,
        seconds,
        isOverEstimate: remainingSeconds === 0,
      };
    },
    [askImageNowMs],
  );

  const renderMessages = ({
    extraClass,
    messages = messagesToShow,
  }: {
    extraClass?: string;
    messages?: AskMessage[];
  } = {}) => {
    if (messages.length === 0) {
      return null;
    }

    return (
      <div
        className={cn(styles.messageList, extraClass)}
        style={
          !mobileStyle
            ? {
                marginBottom: expanded ? '12px' : '0',
              }
            : undefined
        }
      >
        {messages.map((message, index) => {
          const messageRenderKey = `${message.type}-${message.element_bid || index}`;
          const shouldEnableMessageTypewriter =
            message.type === BLOCK_TYPE.ANSWER &&
            message.shouldUseTypewriter === true;
          // if (message.type === BLOCK_TYPE.ANSWER) {
          //   console.log('message', message, shouldEnableMessageTypewriter);
          // }
          return (
            <div
              key={messageRenderKey}
              className={cn(styles.messageWrapper)}
              onClick={() => handleClickTitle(index)}
              style={{
                justifyContent:
                  message.type === BLOCK_TYPE.ASK ? 'flex-end' : 'flex-start',
              }}
            >
              {message.type === BLOCK_TYPE.ASK ? (
                <div
                  className={cn(
                    styles.userMessage,
                    expanded && styles.isExpanded,
                  )}
                >
                  {message.content}
                </div>
              ) : (
                <div
                  className={cn(
                    styles.assistantMessage,
                    styles.askIframeWrapper,
                  )}
                >
                  <ContentRender
                    content={sanitizeAskAnswerContent(message.content)}
                    customRenderBar={
                      message.isStreaming
                        ? () =>
                            message.content?.trim() ? (
                              <StreamingLoadingDotsBar />
                            ) : (
                              <LoadingBar />
                            )
                        : () => null
                    }
                    onSend={() => {}}
                    userInput={''}
                    interactionDefaultValueOptions={
                      lessonFeedbackInteractionDefaultValueOptions
                    }
                    enableTypewriter={shouldEnableMessageTypewriter}
                    typingSpeed={CHAT_TYPEWRITER_SPEED_MS}
                    readonly={true}
                    copyButtonText={copyButtonText}
                    copiedButtonText={copiedButtonText}
                  />
                  {renderImageRefs(message.imageRefs)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderImageRefs = (imageRefs: LearnerAskImageRef[] = []) => {
    const visibleRefs = imageRefs.filter(ref => ref.status !== 'skipped');
    if (!visibleRefs.length) {
      return null;
    }

    return (
      <div className={styles.askImageList}>
        {visibleRefs.map(ref => {
          const imageUrl = ref.asset?.url || '';
          const isReady =
            (ref.status === 'ready' || ref.status === 'reused') &&
            Boolean(imageUrl);
          const isFailed = ref.status === 'failed';
          const eta = formatAskImageEta(ref);
          return (
            <div
              key={ref.ref_bid}
              id={`ask-image-${ref.ref_bid}`}
              className={cn(
                styles.askImageCard,
                highlightedImageRefBid === ref.ref_bid &&
                  styles.askImageCardHighlighted,
              )}
            >
              {isReady ? (
                <img
                  className={styles.askImage}
                  src={imageUrl}
                  alt={ref.description || t('module.chat.askImageAlt')}
                />
              ) : (
                <div className={styles.askImagePending}>
                  {isFailed
                    ? t('module.chat.askImageFailed')
                    : eta.isOverEstimate
                      ? t('module.chat.askImageGeneratingNearlyReady')
                      : t('module.chat.askImageGeneratingWithEta', {
                          minutes: eta.minutes,
                          seconds: eta.seconds,
                        })}
                </div>
              )}
              {ref.description && (
                <div className={styles.askImageCaption}>{ref.description}</div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderInput = (extraClass?: string) => {
    if (!expanded) {
      return null;
    }

    return (
      <div
        className={cn(extraClass)}
        ref={inputWrapperRef}
      >
        <MarkdownFlowInput
          placeholder={t('module.chat.askContent')}
          value={inputValue}
          onChange={handleInputChange}
          onSend={handleSendCustomQuestion}
          className={cn(
            styles.inputGroup,
            isStreamingRef.current ? styles.isSending : '',
          )}
        />
      </div>
    );
  };

  if (shouldRenderMobileDialog) {
    return (
      <div className={cn(styles.askBlock, className, styles.mobile)}>
        {!expanded && renderMessages()}
        {(expanded || hasStreamingAnswerTypewriterMessage) && (
          <>
            <div
              className={styles.mobileOverlay}
              onClick={handleClose}
              style={expanded ? undefined : { display: 'none' }}
            />
            <div
              className={cn(
                styles.mobilePanel,
                isLandscapeSlideMobileDialog && styles.mobilePanelLandscape,
                isFullscreen ? styles.mobilePanelFullscreen : '',
              )}
              style={expanded ? undefined : { display: 'none' }}
            >
              <div className={styles.mobileHeader}>
                <div className={styles.mobileTitle}>
                  {courseAvatar && (
                    <Avatar className='w-7 h-7 mr-2'>
                      <AvatarImage src={courseAvatar} />
                    </Avatar>
                  )}
                  <span>{t('module.chat.ask')}</span>
                </div>
                <div className={styles.mobileActions}>
                  <button
                    type='button'
                    className={styles.mobileActionButton}
                    onClick={handleToggleFullscreen}
                    aria-label={isFullscreen ? 'Collapse' : 'Expand'}
                  >
                    {isFullscreen ? (
                      <Minimize2 size={18} />
                    ) : (
                      <Maximize2 size={18} />
                    )}
                  </button>
                  <button
                    type='button'
                    className={styles.mobileActionButton}
                    onClick={handleClose}
                    aria-label='Close'
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>
              <div
                className={cn(
                  styles.mobileContent,
                  !hasAskAnswerMessages && styles.mobileContentHidden,
                )}
                ref={mobileContentRef}
              >
                {renderMessages({
                  extraClass: styles.mobileMessageList,
                  messages: displayList,
                })}
              </div>
              {renderInput(styles.mobileInput)}
            </div>
          </>
        )}
      </div>
    );
  }

  if (
    (isDesktopSlideAskBlock || forceDesktopSlidePanel) &&
    (expanded || hasStreamingAnswerTypewriterMessage)
  ) {
    return (
      <div
        className={cn(
          styles.askBlock,
          className,
          styles.desktopSlidePanel,
          !hasAskAnswerMessages && styles.desktopSlidePanelEmpty,
        )}
        style={expanded ? undefined : { display: 'none' }}
      >
        <div className={styles.desktopSlideHeader}>
          <div className={styles.desktopSlideTitle}>{t('module.chat.ask')}</div>
          <button
            type='button'
            className={styles.desktopSlideActionButton}
            onClick={handleClose}
            aria-label='Close'
          >
            <X size={18} />
          </button>
        </div>
        <div
          className={cn(
            styles.desktopSlideContent,
            !hasAskAnswerMessages && styles.desktopSlideContentHidden,
          )}
          ref={mobileContentRef}
        >
          {renderMessages({
            extraClass: styles.desktopSlideMessageList,
            messages: displayList,
          })}
        </div>
        {renderInput(styles.desktopSlideInput)}
      </div>
    );
  }

  return (
    <div
      className={cn(
        styles.askBlock,
        className,
        mobileStyle ? styles.mobile : '',
      )}
      style={
        isSlideAskBlock
          ? undefined
          : {
              marginTop: expanded || messagesToShow.length > 0 ? '8px' : '0',
              padding: expanded || messagesToShow.length > 0 ? '16px' : '0',
            }
      }
    >
      {renderMessages()}
      {renderInput()}
    </div>
  );
}
