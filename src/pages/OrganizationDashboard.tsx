
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, isPast } from "date-fns";
import { Edit, Users, Calendar, CheckCircle, Info } from "lucide-react";
import { useEffect } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import VolunteerAnalytics from "./organization/components/VolunteerAnalytics";

const OrganizationDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: events, isLoading } = useQuery({
    queryKey: ['organization-events', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('organization_id', user?.id)
        .order('date', { ascending: true });

      if (error) throw error;
      return data;
    },
    enabled: !!user
  });

  const { data: registrations } = useQuery({
    queryKey: ['organization-registrations', user?.id],
    queryFn: async () => {
      if (!events || events.length === 0) return [];
    
      const { data, error } = await supabase
        .from('registrations')
        .select(`
          id,
          event_id,
          user_id,
          registration_time,
          emergency_contact,
          dietary_restrictions,
          notes,
          profiles:user_id (
            full_name,
            phone,
            profile_image_url
          )
        `)
        .in('event_id', events.map(event => event.id));

      if (error) throw error;
      
      // Now fetch user emails separately
      const userIds = data.map(reg => reg.user_id).filter(Boolean);
      
      if (userIds.length === 0) return data;
      
      const { data: userEmailsData, error: emailError } = await supabase
        .from('profiles')
        .select('id, user_email: auth.users!id.email')
        .in('id', userIds);
      
      if (emailError) {
        console.error("Error fetching user emails:", emailError);
        return data;
      }
      
      // Create email lookup map
      const emailMap = {};
      userEmailsData.forEach(user => {
        emailMap[user.id] = user.user_email;
      });
      
      // Add emails to registrations
      return data.map(reg => ({
        ...reg,
        user_email: reg.user_id ? emailMap[reg.user_id] : null
      }));
    },
    enabled: !!events && events.length > 0
  });

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('organization-events-changes')
      .on(
        'postgres_changes',
        {
          event: '*', // Listen for ALL changes including DELETE
          schema: 'public',
          table: 'events',
          filter: `organization_id=eq.${user.id}`
        },
        (payload) => {
          console.log("Events changed, refreshing data:", payload);
          queryClient.invalidateQueries({ queryKey: ['organization-events', user?.id] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, queryClient]);

  useEffect(() => {
    if (!user || !events || events.length === 0) return;

    const eventIds = events.map(e => e.id);
    
    if (eventIds.length === 0) return;
    
    const channel = supabase
      .channel('registrations-changes')
      .on(
        'postgres_changes',
        {
          event: '*', // Listen for ALL changes including DELETE
          schema: 'public',
          table: 'registrations',
          filter: `event_id=in.(${eventIds.join(',')})`
        },
        (payload) => {
          console.log("Registration changes detected, refreshing data:", payload);
          queryClient.invalidateQueries({ queryKey: ['organization-registrations', user?.id] });
          queryClient.invalidateQueries({ queryKey: ['organization-events', user?.id] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, events, queryClient]);

  const getEventRegistrations = (eventId: string) => {
    return registrations?.filter(reg => reg.event_id === eventId) || [];
  };

  const stats = {
    totalEvents: events?.length || 0,
    activeEvents: events?.filter(event => !isPast(new Date(event.date))).length || 0,
    totalVolunteers: events?.reduce((acc, event) => acc + (event.current_volunteers || 0), 0) || 0,
    completedEvents: events?.filter(event => isPast(new Date(event.date))).length || 0,
  };

  if (isLoading) {
    return <div className="container mx-auto px-4 py-8">Loading...</div>;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Organization Dashboard</h1>
        <Link to="/events/create">
          <Button>Create New Event</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card className="p-6">
          <div className="flex items-center mb-2">
            <Calendar className="w-5 h-5 mr-2 text-primary" />
            <h3 className="text-lg font-semibold">Total Events</h3>
          </div>
          <p className="text-3xl font-bold">{stats.totalEvents}</p>
        </Card>
        <Card className="p-6">
          <div className="flex items-center mb-2">
            <Calendar className="w-5 h-5 mr-2 text-green-500" />
            <h3 className="text-lg font-semibold">Active Events</h3>
          </div>
          <p className="text-3xl font-bold">{stats.activeEvents}</p>
        </Card>
        <Card className="p-6">
          <div className="flex items-center mb-2">
            <Users className="w-5 h-5 mr-2 text-blue-500" />
            <h3 className="text-lg font-semibold">Total Volunteers</h3>
          </div>
          <p className="text-3xl font-bold">{stats.totalVolunteers}</p>
        </Card>
        <Card className="p-6">
          <div className="flex items-center mb-2">
            <CheckCircle className="w-5 h-5 mr-2 text-gray-500" />
            <h3 className="text-lg font-semibold">Completed Events</h3>
          </div>
          <p className="text-3xl font-bold">{stats.completedEvents}</p>
        </Card>
      </div>

      {registrations && registrations.length > 0 && events && (
        <div className="mb-8">
          <VolunteerAnalytics 
            registrations={registrations} 
            events={events} 
          />
        </div>
      )}

      <h2 className="text-2xl font-bold mb-4">Your Events</h2>
      <div className="grid gap-4">
        {events?.map((event) => {
          const eventRegistrations = getEventRegistrations(event.id);
          const isEventPast = isPast(new Date(event.date));
          
          return (
            <Card key={event.id} className="p-6">
              <div className="flex gap-4">
                {event.image_url && (
                  <img 
                    src={event.image_url} 
                    alt={event.title}
                    className="w-32 h-32 object-cover rounded-lg"
                  />
                )}
                <div className="flex-1">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-xl font-semibold">{event.title}</h3>
                      <p className="text-gray-600">
                        Date: {format(new Date(event.date), 'PPP')} at {event.time}
                      </p>
                      <p className="text-gray-600">Location: {event.location}</p>
                    </div>
                    <div className="text-right space-y-2">
                      <p className="text-sm text-gray-600">
                        {event.current_volunteers} / {event.volunteers_needed} volunteers
                      </p>
                      <div className="flex space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`/events/${event.id}/edit`)}
                        >
                          <Edit className="w-4 h-4 mr-1" />
                          Edit
                        </Button>
                        <Link to={`/events/${event.id}`}>
                          <Button size="sm">View</Button>
                        </Link>
                      </div>
                      <span className={`inline-block px-3 py-1 rounded-full text-sm ${
                        !isEventPast 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {!isEventPast ? 'Active' : 'Completed'}
                      </span>
                    </div>
                  </div>
                  
                  {eventRegistrations.length > 0 && (
                    <div className="mt-4 pt-4 border-t">
                      <div className="flex items-center mb-2">
                        <Users className="w-4 h-4 mr-2 text-primary" />
                        <h4 className="font-medium">Registered Volunteers</h4>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {eventRegistrations.slice(0, 8).map((reg) => (
                          <TooltipProvider key={reg.id}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="relative cursor-help">
                                  <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden">
                                    {reg.profiles?.profile_image_url ? (
                                      <img 
                                        src={reg.profiles.profile_image_url} 
                                        alt={reg.profiles.full_name || ''} 
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      <Users size={16} />
                                    )}
                                  </div>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{reg.profiles?.full_name || 'Anonymous'}</p>
                                {reg.user_email && (
                                  <p className="text-xs">{reg.user_email}</p>
                                )}
                                {reg.profiles?.phone && (
                                  <p className="text-xs">{reg.profiles.phone}</p>
                                )}
                                <p className="text-xs">
                                  Registered on {format(new Date(reg.registration_time), 'PPP')}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ))}
                        
                        {eventRegistrations.length > 8 && (
                          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-medium">
                            +{eventRegistrations.length - 8}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
        
        {events?.length === 0 && (
          <Card className="p-6 text-center">
            <div className="flex flex-col items-center py-8">
              <Info className="w-12 h-12 text-gray-400 mb-4" />
              <h3 className="text-xl font-medium mb-2">No Events Yet</h3>
              <p className="text-gray-500 mb-4">Get started by creating your first event</p>
              <Link to="/events/create">
                <Button>Create New Event</Button>
              </Link>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};

export default OrganizationDashboard;
