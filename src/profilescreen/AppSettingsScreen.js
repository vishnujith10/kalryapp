import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import supabase from '../lib/supabase';

// Configure notification handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const COLORS = {
  primary: '#7C3AED',
  primaryLight: '#A084E8',
  background: '#E8E9F0',
  surface: '#FFFFFF',
  text: '#181A20',
  textSecondary: '#666666',
  textMuted: '#999999',
  border: '#E5E7EB',
  success: '#10B981',
  error: '#EF4444',
  warning: '#F59E0B',
};

const AppSettingsScreen = () => {
  const navigation = useNavigation();
  
  // Notifications State
  const [dailyReminders, setDailyReminders] = useState(false);
  const [mealReminders, setMealReminders] = useState(false);
  const [workoutReminders, setWorkoutReminders] = useState(false);
  const [sleepReminders, setSleepReminders] = useState(false);
  
  // Time picker states - Initialize with default times
  const getDefaultMealTime = () => {
    const date = new Date();
    date.setHours(8, 0, 0, 0);
    return date;
  };
  
  const getDefaultWorkoutTime = () => {
    const date = new Date();
    date.setHours(17, 30, 0, 0);
    return date;
  };
  
  const getDefaultSleepTime = () => {
    const date = new Date();
    date.setHours(22, 0, 0, 0); // Default 10:00 PM
    return date;
  };
  
  const [mealReminderTime, setMealReminderTime] = useState(getDefaultMealTime());
  const [workoutReminderTime, setWorkoutReminderTime] = useState(getDefaultWorkoutTime());
  const [sleepReminderTime, setSleepReminderTime] = useState(getDefaultSleepTime());
  const [showMealTimePicker, setShowMealTimePicker] = useState(false);
  const [showWorkoutTimePicker, setShowWorkoutTimePicker] = useState(false);
  const [showSleepTimePicker, setShowSleepTimePicker] = useState(false);
  
  // Notification IDs storage
  const notificationIdsRef = useRef({
    meal: null,
    workout: null,
    sleep: null,
  });
  
  // AI Insights State
  const [aiInsights, setAiInsights] = useState(true);
  const [insightFrequency, setInsightFrequency] = useState('Weekly');
  const [focusAreas, setFocusAreas] = useState({
    calories: true,
    sleep: true,
    workout: true,
    Hydration: false,
  });
  
  // Privacy & Data State
  const [anonymousDataSharing, setAnonymousDataSharing] = useState(true);
  
  // General State
  const [language, setLanguage] = useState('English');

  // Request notification permissions
  useEffect(() => {
    const requestPermissions = async () => {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      
      if (finalStatus !== 'granted') {
        console.log('Notification permissions not granted');
      }
    };
    
    requestPermissions();
  }, []);

  // Notification messages
  const getNotificationMessages = (type) => {
    const messages = {
      meal: [
        "🍽️ Time to fuel your body! Log your meal when you're ready.",
        "Ready to log your meal? Your body needs nourishment! 🥗",
        "Meal time! Take a moment to log what you're eating. 🍎",
        "Don't forget to log your meal! Every bite counts towards your goals. 💪",
      ],
      workout: [
        "💪 Ready to move? Even 10 minutes of activity makes a difference!",
        "Time for some movement! Your body will thank you. 🏃‍♀️",
        "Exercise reminder: Every step counts towards your health goals! 🏋️",
        "Feel like moving today? A quick workout can boost your energy! ⚡",
      ],
      sleep: [
        "🌙 Time to wind down! Quality sleep is essential for your health.",
        "Getting ready for bed? Log your sleep to track your rest patterns. 😴",
        "Sleep reminder: A good night's rest helps you perform better tomorrow! 🌟",
        "Time to log your sleep! Rest is just as important as activity. 💤",
      ],
    };
    
    const options = messages[type] || ['Reminder'];
    return options[Math.floor(Math.random() * options.length)];
  };

  // Cancel notification
  const cancelNotification = useCallback(async (type) => {
    try {
      const notificationId = notificationIdsRef.current[type];
      if (notificationId) {
        await Notifications.cancelScheduledNotificationAsync(notificationId);
        notificationIdsRef.current[type] = null;
        console.log(`✅ Cancelled ${type} notification`);
      }
    } catch (error) {
      console.error(`Error cancelling ${type} notification:`, error);
    }
  }, []);

  // Schedule daily recurring notification
  const scheduleNotification = useCallback(async (type, time, enabled) => {
    try {
      // Cancel existing notification first
      await cancelNotification(type);
      
      if (!enabled) {
        return;
      }

      const hours = time.getHours();
      const minutes = time.getMinutes();
      
      const trigger = {
        hour: hours,
        minute: minutes,
        repeats: true,
      };

      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: type === 'meal' ? 'Meal Reminder' : type === 'workout' ? 'Workout Reminder' : 'Sleep Reminder',
          body: getNotificationMessages(type),
          sound: true,
          priority: Notifications.AndroidNotificationPriority.HIGH,
        },
        trigger,
      });

      // Store notification ID
      notificationIdsRef.current[type] = notificationId;
      console.log(`✅ Scheduled ${type} notification at ${hours}:${minutes.toString().padStart(2, '0')}`);
    } catch (error) {
      console.error(`Error scheduling ${type} notification:`, error);
    }
  }, [cancelNotification]);

  // Update all notifications when states change
  useEffect(() => {
    const updateNotifications = async () => {
      if (dailyReminders) {
        if (mealReminders) {
          await scheduleNotification('meal', mealReminderTime, true);
        } else {
          await cancelNotification('meal');
        }
        
        if (workoutReminders) {
          await scheduleNotification('workout', workoutReminderTime, true);
        } else {
          await cancelNotification('workout');
        }
        
        if (sleepReminders) {
          await scheduleNotification('sleep', sleepReminderTime, true);
        } else {
          await cancelNotification('sleep');
        }
      } else {
        // Cancel all notifications if daily reminders is off
        await cancelNotification('meal');
        await cancelNotification('workout');
        await cancelNotification('sleep');
      }
    };

    updateNotifications();
  }, [dailyReminders, mealReminders, workoutReminders, sleepReminders, mealReminderTime, workoutReminderTime, sleepReminderTime, scheduleNotification, cancelNotification]);

  const handleFocusAreaToggle = (area) => {
    setFocusAreas(prev => ({
      ...prev,
      [area]: !prev[area]
    }));
  };

  const handleDailyRemindersToggle = (value) => {
    setDailyReminders(value);
    // If turning off daily reminders, turn off meal, workout, and sleep reminders too
    if (!value) {
      setMealReminders(false);
      setWorkoutReminders(false);
      setSleepReminders(false);
    }
  };

  const handleMealRemindersToggle = (value) => {
    // Only allow turning on if daily reminders is enabled
    if (value && !dailyReminders) {
      return; // Don't allow turning on if daily reminders is off
    }
    setMealReminders(value);
  };

  const handleWorkoutRemindersToggle = (value) => {
    // Only allow turning on if daily reminders is enabled
    if (value && !dailyReminders) {
      return; // Don't allow turning on if daily reminders is off
    }
    setWorkoutReminders(value);
  };

  const handleSleepRemindersToggle = (value) => {
    // Only allow turning on if daily reminders is enabled
    if (value && !dailyReminders) {
      return; // Don't allow turning on if daily reminders is off
    }
    setSleepReminders(value);
  };

  const formatTime = (date) => {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    const displayMinutes = minutes.toString().padStart(2, '0');
    return `${displayHours}:${displayMinutes} ${ampm}`;
  };

  const handleMealTimeChange = (event, selectedTime) => {
    if (Platform.OS === 'android') {
      setShowMealTimePicker(false);
      if (event.type === 'set' && selectedTime) {
        setMealReminderTime(selectedTime);
      }
    } else {
      if (selectedTime) {
        setMealReminderTime(selectedTime);
      }
    }
  };

  const handleWorkoutTimeChange = (event, selectedTime) => {
    if (Platform.OS === 'android') {
      setShowWorkoutTimePicker(false);
      if (event.type === 'set' && selectedTime) {
        setWorkoutReminderTime(selectedTime);
        // Notification will be updated automatically via useEffect
      }
    } else {
      if (selectedTime) {
        setWorkoutReminderTime(selectedTime);
        // Notification will be updated automatically via useEffect
      }
    }
  };

  const handleSleepTimeChange = (event, selectedTime) => {
    if (Platform.OS === 'android') {
      setShowSleepTimePicker(false);
      if (event.type === 'set' && selectedTime) {
        setSleepReminderTime(selectedTime);
        // Notification will be updated automatically via useEffect
      }
    } else {
      if (selectedTime) {
        setSleepReminderTime(selectedTime);
        // Notification will be updated automatically via useEffect
      }
    }
  };

  const handleDataExport = () => {
    // TODO: Implement data export functionality
    console.log('Exporting data...');
  };

  const handleClearHistory = () => {
    // TODO: Implement clear history functionality
    console.log('Clearing history...');
  };

  const handleLogout = async () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase.auth.signOut();
              if (error) {
                Alert.alert('Error', 'Failed to logout. Please try again.');
                console.error('Logout error:', error);
              } else {
                // Navigate to login screen
                navigation.reset({
                  index: 0,
                  routes: [{ name: 'Login' }],
                });
              }
            } catch (error) {
              Alert.alert('Error', 'An unexpected error occurred.');
              console.error('Logout error:', error);
            }
          },
        },
      ]
    );
  };

  const renderSection = (title, children) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );

  // Animated Toggle Item Component
  const AnimatedToggleItem = React.memo(({ label, value, onValueChange, subtitle, disabled, onLabelPress }) => {
    const scaleAnim = useRef(new Animated.Value(1)).current;
    const opacityAnim = useRef(new Animated.Value(1)).current;

    const handleToggle = (newValue) => {
      // Animate on press - smooth scale and opacity transition
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scaleAnim, {
            toValue: 0.95,
            duration: 100,
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(opacityAnim, {
            toValue: 0.7,
            duration: 100,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true,
          }),
        ]),
      ]).start();

      // Call the original onValueChange
      onValueChange(newValue);
    };

    return (
      <Animated.View
        style={[
          styles.settingItem,
          disabled && styles.settingItemDisabled,
          {
            transform: [{ scale: scaleAnim }],
            opacity: opacityAnim,
          },
        ]}
      >
        <TouchableOpacity
          style={styles.settingLeft}
          onPress={onLabelPress}
          disabled={!onLabelPress || disabled}
          activeOpacity={onLabelPress ? 0.7 : 1}
        >
          <Text style={[styles.settingLabel, disabled && styles.settingLabelDisabled]}>{label}</Text>
          {subtitle && (
            <Text style={[styles.settingSubtitle, disabled && styles.settingSubtitleDisabled]}>{subtitle}</Text>
          )}
        </TouchableOpacity>
        <Animated.View
          style={{
            transform: [{ scale: scaleAnim }],
          }}
        >
          <Switch
            value={value}
            onValueChange={handleToggle}
            disabled={disabled}
            trackColor={{ false: '#E5E7EB', true: COLORS.primaryLight }}
            thumbColor={value ? COLORS.primary : '#FFFFFF'}
            ios_backgroundColor="#E5E7EB"
          />
        </Animated.View>
      </Animated.View>
    );
  });

  AnimatedToggleItem.displayName = 'AnimatedToggleItem';

  const renderToggleItem = (label, value, onValueChange, subtitle = null, disabled = false, onLabelPress = null) => (
    <AnimatedToggleItem
      label={label}
      value={value}
      onValueChange={onValueChange}
      subtitle={subtitle}
      disabled={disabled}
      onLabelPress={onLabelPress}
    />
  );

  const renderPillButton = (label, isSelected, onPress) => (
    <TouchableOpacity
      style={[
        styles.pillButton,
        isSelected ? styles.pillButtonSelected : styles.pillButtonUnselected
      ]}
      onPress={onPress}
    >
      <Text style={[
        styles.pillButtonText,
        isSelected ? styles.pillButtonTextSelected : styles.pillButtonTextUnselected
      ]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  const renderPillGroup = (options, selectedValue, onSelect) => (
    <View style={styles.pillGroup}>
      {options.map((option) => (
        <TouchableOpacity
          key={option}
          style={[
            styles.pillButton,
            selectedValue === option ? styles.pillButtonSelected : styles.pillButtonUnselected
          ]}
          onPress={() => onSelect(option)}
        >
          <Text style={[
            styles.pillButtonText,
            selectedValue === option ? styles.pillButtonTextSelected : styles.pillButtonTextUnselected
          ]}>
            {option}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
      
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity 
              style={styles.backButton}
              onPress={() => navigation.goBack()}
            >
              <Ionicons name="chevron-back" size={24} color="#333" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>App Settings</Text>
            <View style={styles.headerSpacer} />
          </View>
          
          {/* Notifications Section */}
          {renderSection('Notifications', (
            <View style={styles.sectionContent}>
              {renderToggleItem('Daily Reminders', dailyReminders, handleDailyRemindersToggle)}
              {renderToggleItem(
                'Meal Reminders', 
                mealReminders, 
                handleMealRemindersToggle, 
                formatTime(mealReminderTime),
                !dailyReminders, // Disabled if daily reminders is off
                !dailyReminders ? null : () => setShowMealTimePicker(true) // Show time picker on text click
              )}
              {renderToggleItem(
                'Workout Reminders', 
                workoutReminders, 
                handleWorkoutRemindersToggle, 
                formatTime(workoutReminderTime),
                !dailyReminders, // Disabled if daily reminders is off
                !dailyReminders ? null : () => setShowWorkoutTimePicker(true) // Show time picker on text click
              )}
              {renderToggleItem(
                'Sleep Reminders', 
                sleepReminders, 
                handleSleepRemindersToggle, 
                formatTime(sleepReminderTime),
                !dailyReminders, // Disabled if daily reminders is off
                !dailyReminders ? null : () => setShowSleepTimePicker(true) // Show time picker on text click
              )}
            </View>
          ))}

          {/* Time Picker Modals */}
          {Platform.OS === 'ios' && (
            <>
              <Modal
                visible={showMealTimePicker}
                transparent
                animationType="slide"
                onRequestClose={() => setShowMealTimePicker(false)}
              >
                <View style={styles.modalOverlay}>
                  <View style={styles.modalContent}>
                    <View style={styles.modalHeader}>
                      <TouchableOpacity onPress={() => setShowMealTimePicker(false)}>
                        <Text style={styles.modalCancel}>Cancel</Text>
                      </TouchableOpacity>
                      <Text style={styles.modalTitle}>Select Meal Reminder Time</Text>
                      <TouchableOpacity onPress={() => setShowMealTimePicker(false)}>
                        <Text style={styles.modalDone}>Done</Text>
                      </TouchableOpacity>
                    </View>
                    <DateTimePicker
                      value={mealReminderTime}
                      mode="time"
                      display="spinner"
                      onChange={handleMealTimeChange}
                      style={styles.timePicker}
                    />
                  </View>
                </View>
              </Modal>

              <Modal
                visible={showWorkoutTimePicker}
                transparent
                animationType="slide"
                onRequestClose={() => setShowWorkoutTimePicker(false)}
              >
                <View style={styles.modalOverlay}>
                  <View style={styles.modalContent}>
                    <View style={styles.modalHeader}>
                      <TouchableOpacity onPress={() => setShowWorkoutTimePicker(false)}>
                        <Text style={styles.modalCancel}>Cancel</Text>
                      </TouchableOpacity>
                      <Text style={styles.modalTitle}>Select Workout Reminder Time</Text>
                      <TouchableOpacity onPress={() => setShowWorkoutTimePicker(false)}>
                        <Text style={styles.modalDone}>Done</Text>
                      </TouchableOpacity>
                    </View>
                    <DateTimePicker
                      value={workoutReminderTime}
                      mode="time"
                      display="spinner"
                      onChange={handleWorkoutTimeChange}
                      style={styles.timePicker}
                    />
                  </View>
                </View>
              </Modal>

              <Modal
                visible={showSleepTimePicker}
                transparent
                animationType="slide"
                onRequestClose={() => setShowSleepTimePicker(false)}
              >
                <View style={styles.modalOverlay}>
                  <View style={styles.modalContent}>
                    <View style={styles.modalHeader}>
                      <TouchableOpacity onPress={() => setShowSleepTimePicker(false)}>
                        <Text style={styles.modalCancel}>Cancel</Text>
                      </TouchableOpacity>
                      <Text style={styles.modalTitle}>Select Sleep Reminder Time</Text>
                      <TouchableOpacity onPress={() => setShowSleepTimePicker(false)}>
                        <Text style={styles.modalDone}>Done</Text>
                      </TouchableOpacity>
                    </View>
                    <DateTimePicker
                      value={sleepReminderTime}
                      mode="time"
                      display="spinner"
                      onChange={handleSleepTimeChange}
                      style={styles.timePicker}
                    />
                  </View>
                </View>
              </Modal>
            </>
          )}

          {/* Android Time Pickers */}
          {Platform.OS === 'android' && (
            <>
              {showMealTimePicker && (
                <DateTimePicker
                  value={mealReminderTime}
                  mode="time"
                  display="default"
                  onChange={handleMealTimeChange}
                />
              )}
              {showWorkoutTimePicker && (
                <DateTimePicker
                  value={workoutReminderTime}
                  mode="time"
                  display="default"
                  onChange={handleWorkoutTimeChange}
                />
              )}
              {showSleepTimePicker && (
                <DateTimePicker
                  value={sleepReminderTime}
                  mode="time"
                  display="default"
                  onChange={handleSleepTimeChange}
                />
              )}
            </>
          )}

          {/* AI Insights Section */}
          {renderSection('AI Insights', (
            <View style={styles.sectionContent}>
              {renderToggleItem('Enable AI Insights', aiInsights, setAiInsights)}
              
              <View style={styles.infoRow}>
                <Ionicons name="information-circle-outline" size={16} color={COLORS.textMuted} />
                <Text style={styles.infoText}>AI insights help you reflect and optimize your routine.</Text>
              </View>

              <View style={styles.subsection}>
                <Text style={styles.subsectionTitle}>Insight Frequency</Text>
                {renderPillGroup(['Daily', 'Weekly'], insightFrequency, setInsightFrequency)}
              </View>

              <View style={styles.subsection}>
                <Text style={styles.subsectionTitle}>Focus Areas</Text>
                <View style={styles.pillGroup}>
                  {Object.entries(focusAreas).map(([area, isSelected]) => (
                    <TouchableOpacity
                      key={area}
                      style={[
                        styles.pillButton,
                        isSelected ? styles.pillButtonSelected : styles.pillButtonUnselected
                      ]}
                      onPress={() => handleFocusAreaToggle(area)}
                    >
                      <Text style={[
                        styles.pillButtonText,
                        isSelected ? styles.pillButtonTextSelected : styles.pillButtonTextUnselected
                      ]}>
                        {area.charAt(0).toUpperCase() + area.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          ))}

          {/* Privacy & Data Section */}
          {renderSection('Privacy & Data', (
            <View style={styles.sectionContent}>
              {renderToggleItem('Anonymous Data Sharing', anonymousDataSharing, setAnonymousDataSharing)}
              
              <View style={styles.settingItem}>
                <View style={styles.settingLeft}>
                  <Text style={styles.settingLabel}>Data Export</Text>
                  <Text style={styles.settingSubtitle}>Last export: 2 days ago</Text>
                </View>
                <TouchableOpacity style={styles.exportButton} onPress={handleDataExport}>
                  <Text style={styles.exportButtonText}>Export CSV</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.settingItem}>
                <View style={styles.settingLeft}>
                  <Text style={styles.settingLabel}>Clear History</Text>
                </View>
                <TouchableOpacity style={styles.clearButton} onPress={handleClearHistory}>
                  <Text style={styles.clearButtonText}>Clear</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}

          {/* General Section */}
          {renderSection('General', (
            <View style={styles.sectionContent}>
              <View style={styles.subsection}>
                <Text style={styles.subsectionTitle}>Language</Text>
                {renderPillGroup(['English', 'Español'], language, setLanguage)}
              </View>
              
              <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
                <Ionicons name="log-out-outline" size={20} color={COLORS.error} />
                <Text style={styles.logoutButtonText}>Logout</Text>
              </TouchableOpacity>
            </View>
          ))}

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>Kalry App v2.1.0</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  backButton: {
    padding: 8,
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingTop: 0,
    paddingHorizontal: 0,
    paddingBottom: 20,
  },
  section: {
    marginBottom: 24,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 16,
  },
  sectionContent: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  settingLeft: {
    flex: 1,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
  },
  settingSubtitle: {
    fontSize: 14,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  settingItemDisabled: {
    opacity: 0.5,
  },
  settingLabelDisabled: {
    color: COLORS.textMuted,
  },
  settingSubtitleDisabled: {
    color: COLORS.textMuted,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  infoText: {
    fontSize: 14,
    color: COLORS.textMuted,
    marginLeft: 8,
    flex: 1,
  },
  subsection: {
    marginTop: 16,
  },
  subsectionTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 12,
  },
  pillGroup: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pillButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillButtonSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  pillButtonUnselected: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
  },
  pillButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  pillButtonTextSelected: {
    color: COLORS.surface,
  },
  pillButtonTextUnselected: {
    color: COLORS.textSecondary,
  },
  exportButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  exportButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  clearButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.error,
  },
  clearButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.error,
  },
  logoutButton: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.error,
    marginVertical: 8,
  },
  logoutButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.error,
    marginLeft: 8,
  },
  footer: {
    alignItems: 'center',
    marginTop: 32,
    marginBottom: 20,
  },
  footerText: {
    fontSize: 14,
    color: COLORS.textMuted,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  modalCancel: {
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  modalDone: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.primary,
  },
  timePicker: {
    width: '100%',
    height: 200,
  },
});

export default AppSettingsScreen;
